package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"messenger/internal/models"
	"messenger/internal/services"
	"messenger/internal/websocket"
)

type MessageHandler struct {
	messages *services.MessageService
	hub      *websocket.Hub
	db       *gorm.DB
}

func NewMessageHandler(ms *services.MessageService, hub *websocket.Hub, db *gorm.DB) *MessageHandler {
	return &MessageHandler{messages: ms, hub: hub, db: db}
}

func (h *MessageHandler) GetUsers(c *gin.Context) {
	userID := c.GetString("userId")
	users, err := h.messages.GetUsers(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error.server"})
		return
	}
	c.JSON(http.StatusOK, users)
}

func (h *MessageHandler) GetFriends(c *gin.Context) {
	userID := c.GetString("userId")
	users, err := h.messages.GetFriends(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, users)
}

func (h *MessageHandler) RemoveFriend(c *gin.Context) {
	userID := c.GetString("userId")
	friendID := c.Param("userId")
	if err := h.messages.RemoveFriend(userID, friendID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pushFriendsUpdated(userID, friendID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// BlockUser prevents the target from sending any messages/signaling to the caller.
func (h *MessageHandler) BlockUser(c *gin.Context) {
	userID := c.GetString("userId")
	targetID := strings.TrimSpace(c.Param("userId"))
	if targetID == "" || targetID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.badRequest"})
		return
	}
	if err := h.messages.SetBlocked(userID, targetID, true); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.unknown"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) UnblockUser(c *gin.Context) {
	userID := c.GetString("userId")
	targetID := strings.TrimSpace(c.Param("userId"))
	if targetID == "" || targetID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.badRequest"})
		return
	}
	if err := h.messages.SetBlocked(userID, targetID, false); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.unknown"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type sendFriendRequestRequest struct {
	Query string `json:"query" binding:"required"`
}

func (h *MessageHandler) SendFriendRequest(c *gin.Context) {
	var req sendFriendRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := c.GetString("userId")
	fr, err := h.messages.SendFriendRequest(userID, req.Query)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pushFriendsUpdated(fr.SenderID, fr.ReceiverID)
	c.JSON(http.StatusCreated, fr)
}

func (h *MessageHandler) GetFriendRequests(c *gin.Context) {
	userID := c.GetString("userId")
	in, out, err := h.messages.GetFriendRequests(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"incoming": in, "outgoing": out})
}

func (h *MessageHandler) AcceptFriendRequest(c *gin.Context) {
	userID := c.GetString("userId")
	reqID := c.Param("requestId")
	fr, err := h.messages.AcceptFriendRequest(userID, reqID)
	if err != nil {
		if err.Error() == "forbidden" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pushFriendsUpdated(fr.SenderID, fr.ReceiverID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) DeclineFriendRequest(c *gin.Context) {
	userID := c.GetString("userId")
	reqID := c.Param("requestId")
	fr, err := h.messages.DeclineFriendRequest(userID, reqID)
	if err != nil {
		if err.Error() == "forbidden" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pushFriendsUpdated(fr.SenderID, fr.ReceiverID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) CancelFriendRequest(c *gin.Context) {
	userID := c.GetString("userId")
	reqID := c.Param("requestId")
	fr, err := h.messages.CancelFriendRequest(userID, reqID)
	if err != nil {
		if err.Error() == "forbidden" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pushFriendsUpdated(fr.SenderID, fr.ReceiverID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) pushFriendsUpdated(userIDs ...string) {
	for _, uid := range uniqueStrings(userIDs) {
		if uid == "" {
			continue
		}
		h.hub.SendToUser(uid, &websocket.Message{
			Type:      "friends-updated",
			SenderID:  "system",
			Payload:   map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano)},
			Timestamp: time.Now(),
		})
	}
}

func (h *MessageHandler) GetConversations(c *gin.Context) {
	userID := c.GetString("userId")
	list, err := h.messages.GetConversations(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

type createConversationRequest struct {
	ParticipantIDs []string `json:"participantIds" binding:"required"`
	IsGroup        bool     `json:"isGroup"`
	Name           string   `json:"name"`
}

func (h *MessageHandler) CreateConversation(c *gin.Context) {
	var req createConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userId")
	ids := uniqueStrings(append([]string{userID}, req.ParticipantIDs...))
	if len(ids) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one other participant is required"})
		return
	}

	conv, err := h.messages.CreateConversation(ids, req.IsGroup, req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, conv)
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func (h *MessageHandler) GetMessages(c *gin.Context) {
	userID := c.GetString("userId")
	convID := c.Param("conversationId")

	ok, err := h.messages.IsUserInConversation(userID, convID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a participant"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 500 {
		limit = 50
	}

	msgs, err := h.messages.GetMessages(userID, convID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, msgs)
}

type sendMessageRequest struct {
	ConversationID   string `json:"conversationId" binding:"required"`
	EncryptedContent string `json:"encryptedContent" binding:"required"`
	IV               string `json:"iv" binding:"required"`
	SenderKey        string `json:"senderKey" binding:"required"`
	MessageType      string `json:"messageType"`
}

func (h *MessageHandler) SendMessage(c *gin.Context) {
	var req sendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userId")
	msg, err := h.messages.SendMessage(userID, req.ConversationID, req.EncryptedContent, req.IV, req.SenderKey, req.MessageType)
	if err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": "error.forbidden"})
			return
		}
		if errors.Is(err, services.ErrBlocked) {
			c.JSON(http.StatusForbidden, gin.H{"error": "error.blocked"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.hub.SendToConversation(req.ConversationID, &websocket.Message{
		Type:           "message",
		ConversationID: req.ConversationID,
		SenderID:       userID,
		Payload: map[string]interface{}{
			"id":               msg.ID,
			"conversationId":   msg.ConversationID,
			"senderId":         msg.SenderID,
			"encryptedContent": msg.EncryptedContent,
			"iv":               msg.IV,
			"senderKey":        msg.SenderKey,
			"messageType":      msg.MessageType,
			"createdAt":        msg.CreatedAt,
			"sender":           msg.Sender,
		},
		Timestamp: time.Now(),
	})

	c.JSON(http.StatusCreated, msg)
}

type patchMessageRequest struct {
	EncryptedContent string `json:"encryptedContent" binding:"required"`
	IV               string `json:"iv" binding:"required"`
	SenderKey        string `json:"senderKey" binding:"required"`
	MessageType      string `json:"messageType"`
}

func (h *MessageHandler) UpdateMessage(c *gin.Context) {
	var req patchMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	msgID := c.Param("messageId")
	msg, err := h.messages.UpdateMessage(userID, convID, msgID, req.EncryptedContent, req.IV, req.SenderKey, req.MessageType)
	if err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
			return
		}
		if err.Error() == "forbidden" || err.Error() == "message deleted" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.hub.SendToConversation(convID, &websocket.Message{
		Type:           "message-updated",
		ConversationID: convID,
		SenderID:       userID,
		Payload: map[string]interface{}{
			"id":               msg.ID,
			"conversationId":   msg.ConversationID,
			"senderId":         msg.SenderID,
			"encryptedContent": msg.EncryptedContent,
			"iv":               msg.IV,
			"senderKey":        msg.SenderKey,
			"messageType":      msg.MessageType,
			"createdAt":        msg.CreatedAt,
			"sender":           msg.Sender,
		},
		Timestamp: time.Now(),
	})

	c.JSON(http.StatusOK, msg)
}

func (h *MessageHandler) DeleteMessage(c *gin.Context) {
	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	msgID := c.Param("messageId")
	if err := h.messages.DeleteMessage(userID, convID, msgID); err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
			return
		}
		if err.Error() == "forbidden" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.hub.SendToConversation(convID, &websocket.Message{
		Type:           "message-deleted",
		ConversationID: convID,
		SenderID:       userID,
		Payload: map[string]interface{}{
			"id":             msgID,
			"conversationId": convID,
		},
		Timestamp: time.Now(),
	})

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type createGroupRequest struct {
	Name        string   `json:"name" binding:"required"`
	Description string   `json:"description"`
	MemberIDs   []string `json:"memberIds"`
}

func (h *MessageHandler) CreateGroup(c *gin.Context) {
	var req createGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ownerID := c.GetString("userId")
	group, err := h.messages.CreateGroup(ownerID, req.Name, req.Description, req.MemberIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, group)
}

type addMemberRequest struct {
	UserID string `json:"userId" binding:"required"`
	Role   string `json:"role"`
}

func (h *MessageHandler) AddGroupMember(c *gin.Context) {
	var req addMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	role := req.Role
	if role == "" {
		role = "member"
	}

	groupID := c.Param("groupId")
	if err := h.messages.AddGroupMember(groupID, req.UserID, role); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true})
}

func (h *MessageHandler) HandleCallOffer(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) HandleCallAnswer(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) HandleICECandidate(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) UploadFile(c *gin.Context) {
	userID := c.GetString("userId")
	conversationID := strings.TrimSpace(c.PostForm("conversationId"))
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.badRequest"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.badRequest"})
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.badRequest"})
		return
	}
	defer src.Close()

	mime := fileHeader.Header.Get("Content-Type")
	record, err := h.messages.StoreUploadedFile(userID, conversationID, fileHeader.Filename, mime, src, fileHeader.Size)
	if err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": "error.forbidden"})
			return
		}
		if err.Error() == "file too large" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "error.fileTooLarge"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "error.unknown"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":       record.ID,
		"name":     record.OriginalName,
		"mime":     record.MimeType,
		"size":     record.SizeBytes,
		"fileLink": "/api/files/" + record.ID,
	})
}

// UploadMessageFile is the canonical upload endpoint used by the frontend:
// POST /api/messages/upload with multipart/form-data field "file".
func (h *MessageHandler) UploadMessageFile(c *gin.Context) {
	h.UploadFile(c)
}

func (h *MessageHandler) DownloadFile(c *gin.Context) {
	userID := c.GetString("userId")
	fileID := c.Param("fileId")
	var f models.UploadedFile
	if err := h.db.First(&f, "id = ?", fileID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	ok, err := h.messages.IsUserInConversation(userID, f.ConversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a participant"})
		return
	}
	key, err := getFileCipherKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize cipher"})
		return
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize cipher"})
		return
	}
	nonce, err := base64.StdEncoding.DecodeString(f.Nonce)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid file nonce"})
		return
	}
	ct, err := os.ReadFile(f.StoragePath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decrypt file"})
		return
	}
	c.Header("Content-Type", f.MimeType)
	c.Header("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(f.OriginalName, `"`, "")+`"`)
	c.Data(http.StatusOK, f.MimeType, plain)
}

func getFileCipherKey() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("FILE_ENCRYPTION_KEY"))
	if raw == "" {
		return nil, errors.New("FILE_ENCRYPTION_KEY is not configured")
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil {
		if len(b) == 32 {
			return b, nil
		}
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, errors.New("FILE_ENCRYPTION_KEY must be 32 bytes or base64-encoded 32 bytes")
}

type patchConversationRequest struct {
	Name   *string `json:"name"`
	Avatar *string `json:"avatar"`
}

func (h *MessageHandler) ClearConversationHistory(c *gin.Context) {
	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	if err := h.messages.SetConversationCleared(userID, convID, time.Now()); err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *MessageHandler) UpdateConversation(c *gin.Context) {
	var req patchConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name == nil && req.Avatar == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nothing to update"})
		return
	}
	if req.Avatar != nil && len(*req.Avatar) > 3145728 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "avatar too large (max 3MB)"})
		return
	}

	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	conv, err := h.messages.UpdateGroupConversation(userID, convID, req.Name, req.Avatar)
	if err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}

type addParticipantsRequest struct {
	UserIDs []string `json:"userIds" binding:"required"`
}

func (h *MessageHandler) AddConversationParticipants(c *gin.Context) {
	var req addParticipantsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	conv, err := h.messages.AddGroupParticipants(userID, convID, req.UserIDs)
	if err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}

func (h *MessageHandler) RemoveConversationParticipant(c *gin.Context) {
	userID := c.GetString("userId")
	convID := c.Param("conversationId")
	targetID := c.Param("userId")
	if targetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing user id"})
		return
	}
	if err := h.messages.RemoveFromGroup(userID, convID, targetID); err != nil {
		if errors.Is(err, services.ErrNotParticipant) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
