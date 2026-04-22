package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"messenger/internal/crypto"
	"messenger/internal/models"
)

// ErrNotParticipant is returned when a user is not in the conversation.
var ErrNotParticipant = errors.New("not a conversation participant")

// ErrBlocked is returned when the recipient has blocked the sender.
var ErrBlocked = errors.New("blocked")

type MessageService struct {
	db     *gorm.DB
	crypto *crypto.E2EEService
}

func NewMessageService(db *gorm.DB, crypto *crypto.E2EEService) *MessageService {
	return &MessageService{
		db:     db,
		crypto: crypto,
	}
}

func (s *MessageService) SendMessage(senderID, conversationID, encryptedContent, iv, senderKey, messageType string) (*models.Message, error) {
	ok, err := s.IsUserInConversation(senderID, conversationID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotParticipant
	}

	// Block enforcement: if ANY other participant has blocked sender, do not allow sending anything.
	ids, err := s.ParticipantUserIDs(conversationID)
	if err != nil {
		return nil, err
	}
	for _, rid := range ids {
		if rid == "" || rid == senderID {
			continue
		}
		blocked, err := s.IsBlocked(rid, senderID) // recipient blocks sender
		if err != nil {
			return nil, err
		}
		if blocked {
			return nil, ErrBlocked
		}
	}

	if messageType == "" {
		messageType = "text"
	}

	message := &models.Message{
		ID:               uuid.New().String(),
		ConversationID:   conversationID,
		SenderID:         senderID,
		EncryptedContent: encryptedContent,
		IV:               iv,
		SenderKey:        senderKey,
		MessageType:      messageType,
		CreatedAt:        time.Now(),
	}

	if err := s.db.Create(message).Error; err != nil {
		return nil, err
	}

	s.db.Model(&models.Conversation{}).Where("id = ?", conversationID).Update("updated_at", time.Now())

	var full models.Message
	if err := s.db.Preload("Sender").First(&full, "id = ?", message.ID).Error; err != nil {
		return message, nil
	}
	return &full, nil
}

// IsBlocked returns true when blockerID has blocked blockedID.
func (s *MessageService) IsBlocked(blockerID, blockedID string) (bool, error) {
	if blockerID == "" || blockedID == "" {
		return false, nil
	}
	var cnt int64
	err := s.db.Model(&models.UserBlock{}).
		Where("blocker_id = ? AND blocked_id = ?", blockerID, blockedID).
		Count(&cnt).Error
	return cnt > 0, err
}

// SetBlocked creates/removes a block relation. Safe to call repeatedly.
func (s *MessageService) SetBlocked(blockerID, blockedID string, blocked bool) error {
	if blockerID == "" || blockedID == "" {
		return errors.New("missing user id")
	}
	if blockerID == blockedID {
		return errors.New("cannot block self")
	}
	if blocked {
		return s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.UserBlock{
			BlockerID: blockerID,
			BlockedID: blockedID,
			CreatedAt: time.Now(),
		}).Error
	}
	return s.db.Where("blocker_id = ? AND blocked_id = ?", blockerID, blockedID).Delete(&models.UserBlock{}).Error
}

// StoreUploadedFile saves an encrypted file blob and metadata to the DB.
// This is NOT E2EE; it is server-side encryption-at-rest + access control by conversation membership.
func (s *MessageService) StoreUploadedFile(userID, conversationID, originalName, mime string, src io.Reader, size int64) (*models.UploadedFile, error) {
	if conversationID == "" {
		return nil, errors.New("missing conversation id")
	}
	ok, err := s.IsUserInConversation(userID, conversationID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotParticipant
	}
	if size <= 0 {
		return nil, errors.New("empty file")
	}
	if size > 25*1024*1024 {
		return nil, errors.New("file too large")
	}
	raw, err := io.ReadAll(src)
	if err != nil {
		return nil, errors.New("failed to read file")
	}

	key, err := getFileCipherKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errors.New("failed to initialize cipher")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.New("failed to initialize cipher")
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, errors.New("failed to encrypt file")
	}
	ciphertext := gcm.Seal(nil, nonce, raw, nil)

	fileID := uuid.NewString()
	dir := os.Getenv("UPLOADS_DIR")
	if strings.TrimSpace(dir) == "" {
		dir = "./uploads"
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, errors.New("failed to store file")
	}
	storageName := fileID + ".bin"
	storagePath := filepath.Join(dir, storageName)
	if err := os.WriteFile(storagePath, ciphertext, 0o600); err != nil {
		return nil, errors.New("failed to store file")
	}
	if strings.TrimSpace(mime) == "" {
		mime = "application/octet-stream"
	}

	record := &models.UploadedFile{
		ID:             fileID,
		OwnerID:        userID,
		ConversationID: conversationID,
		OriginalName:   originalName,
		MimeType:       mime,
		SizeBytes:      size,
		StoragePath:    storagePath,
		Nonce:          base64.StdEncoding.EncodeToString(nonce),
		CreatedAt:      time.Now(),
	}
	if err := s.db.Create(record).Error; err != nil {
		return nil, errors.New("failed to save file metadata")
	}
	return record, nil
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

func (s *MessageService) conversationClearedAt(userID, conversationID string) (*time.Time, error) {
	var st models.ConversationClearState
	err := s.db.Where("user_id = ? AND conversation_id = ?", userID, conversationID).First(&st).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &st.ClearedAt, nil
}

// SetConversationCleared records that the user cleared chat history from their view (max timestamp wins on conflict).
func (s *MessageService) SetConversationCleared(userID, conversationID string, at time.Time) error {
	ok, err := s.IsUserInConversation(userID, conversationID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotParticipant
	}
	var st models.ConversationClearState
	err = s.db.Where("user_id = ? AND conversation_id = ?", userID, conversationID).First(&st).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.db.Create(&models.ConversationClearState{
			UserID:         userID,
			ConversationID: conversationID,
			ClearedAt:      at,
		}).Error
	}
	if err != nil {
		return err
	}
	newAt := at
	if st.ClearedAt.After(newAt) {
		newAt = st.ClearedAt
	}
	return s.db.Model(&st).Update("cleared_at", newAt).Error
}

func (s *MessageService) GetMessages(userID, conversationID string, limit, offset int) ([]models.Message, error) {
	var messages []models.Message
	q := s.db.Where("conversation_id = ? AND is_deleted = ?", conversationID, false)
	cleared, err := s.conversationClearedAt(userID, conversationID)
	if err != nil {
		return nil, err
	}
	if cleared != nil {
		q = q.Where("created_at > ?", *cleared)
	}
	err = q.Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Preload("Sender").
		Find(&messages).Error

	return messages, err
}

// UpdateMessage replaces ciphertext for a message; only the original sender may update.
func (s *MessageService) UpdateMessage(senderID, conversationID, messageID, encryptedContent, iv, senderKey, messageType string) (*models.Message, error) {
	ok, err := s.IsUserInConversation(senderID, conversationID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotParticipant
	}

	var m models.Message
	if err := s.db.First(&m, "id = ?", messageID).Error; err != nil {
		return nil, err
	}
	if m.ConversationID != conversationID {
		return nil, gorm.ErrRecordNotFound
	}
	if m.SenderID != senderID {
		return nil, errors.New("forbidden")
	}
	if m.IsDeleted {
		return nil, errors.New("message deleted")
	}

	if messageType == "" {
		messageType = m.MessageType
	}
	m.EncryptedContent = encryptedContent
	m.IV = iv
	m.SenderKey = senderKey
	m.MessageType = messageType
	if err := s.db.Save(&m).Error; err != nil {
		return nil, err
	}

	s.db.Model(&models.Conversation{}).Where("id = ?", conversationID).Update("updated_at", time.Now())

	var full models.Message
	if err := s.db.Preload("Sender").First(&full, "id = ?", m.ID).Error; err != nil {
		return &m, nil
	}
	return &full, nil
}

// DeleteMessage soft-deletes a message; only the original sender may delete.
func (s *MessageService) DeleteMessage(senderID, conversationID, messageID string) error {
	ok, err := s.IsUserInConversation(senderID, conversationID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotParticipant
	}

	var m models.Message
	if err := s.db.First(&m, "id = ?", messageID).Error; err != nil {
		return err
	}
	if m.ConversationID != conversationID {
		return gorm.ErrRecordNotFound
	}
	if m.SenderID != senderID {
		return errors.New("forbidden")
	}
	return s.db.Model(&m).Update("is_deleted", true).Error
}

func (s *MessageService) CreateConversation(userIDs []string, isGroup bool, name string) (*models.Conversation, error) {
	conversation := &models.Conversation{
		ID:        uuid.New().String(),
		IsGroup:   isGroup,
		Name:      name,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.db.Create(conversation).Error; err != nil {
		return nil, err
	}

	var users []models.User
	if err := s.db.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, err
	}
	if len(users) != len(userIDs) {
		return nil, errors.New("one or more users not found")
	}

	if err := s.db.Model(conversation).Association("Participants").Append(&users); err != nil {
		return nil, err
	}

	var full models.Conversation
	if err := s.db.Preload("Participants").First(&full, "id = ?", conversation.ID).Error; err != nil {
		return conversation, nil
	}
	return &full, nil
}

// ParticipantUserIDs returns user IDs in a conversation (for WebSocket fan-out).
func (s *MessageService) ParticipantUserIDs(conversationID string) ([]string, error) {
	var ids []string
	err := s.db.Table("conversation_participants").
		Where("conversation_id = ?", conversationID).
		Pluck("user_id", &ids).Error
	return ids, err
}

func (s *MessageService) IsUserInConversation(userID, conversationID string) (bool, error) {
	var count int64
	err := s.db.Table("conversation_participants").
		Where("conversation_id = ? AND user_id = ?", conversationID, userID).
		Count(&count).Error
	return count > 0, err
}

func (s *MessageService) GetConversations(userID string) ([]models.Conversation, error) {
	var conversations []models.Conversation
	err := s.db.
		Table("conversations").
		Joins("JOIN conversation_participants ON conversation_participants.conversation_id = conversations.id").
		Where("conversation_participants.user_id = ?", userID).
		Preload("Participants").
		Order("updated_at DESC").
		Find(&conversations).Error
	if err != nil {
		return nil, err
	}
	var states []models.ConversationClearState
	if err := s.db.Where("user_id = ?", userID).Find(&states).Error; err != nil {
		return nil, err
	}
	byConv := make(map[string]time.Time, len(states))
	for _, st := range states {
		byConv[st.ConversationID] = st.ClearedAt
	}
	for i := range conversations {
		if t, ok := byConv[conversations[i].ID]; ok {
			tCopy := t
			conversations[i].MyClearedAt = &tCopy
		}
	}
	return conversations, nil
}

func (s *MessageService) CreateGroup(ownerID, name, description string, memberIDs []string) (*models.Group, error) {
	group := &models.Group{
		ID:          uuid.New().String(),
		Name:        name,
		Description: description,
		OwnerID:     ownerID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.db.Create(group).Error; err != nil {
		return nil, err
	}

	// Add owner as member
	owner := &models.GroupMember{
		GroupID:  group.ID,
		UserID:   ownerID,
		Role:     "admin",
		JoinedAt: time.Now(),
	}
	if err := s.db.Create(owner).Error; err != nil {
		return nil, err
	}

	// Add other members
	for _, memberID := range memberIDs {
		member := &models.GroupMember{
			GroupID:  group.ID,
			UserID:   memberID,
			Role:     "member",
			JoinedAt: time.Now(),
		}
		if err := s.db.Create(member).Error; err != nil {
			return nil, err
		}
	}

	return group, nil
}

func (s *MessageService) GetUsers(userID string) ([]models.User, error) {
	var users []models.User
	err := s.db.Where("id != ?", userID).Find(&users).Error
	return users, err
}

func (s *MessageService) GetFriends(userID string) ([]models.User, error) {
	var ids []string
	if err := s.db.Table("friendships").Where("user_id = ?", userID).Pluck("friend_id", &ids).Error; err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []models.User{}, nil
	}
	var users []models.User
	if err := s.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}

func (s *MessageService) RemoveFriend(userID, friendID string) error {
	if userID == "" || friendID == "" {
		return errors.New("missing user id")
	}
	if userID == friendID {
		return errors.New("cannot remove self")
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("friendships").Where("user_id = ? AND friend_id = ?", userID, friendID).Delete(nil).Error; err != nil {
			return err
		}
		if err := tx.Table("friendships").Where("user_id = ? AND friend_id = ?", friendID, userID).Delete(nil).Error; err != nil {
			return err
		}
		return nil
	})
}

func (s *MessageService) SendFriendRequest(fromUserID, query string) (*models.FriendRequest, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("empty query")
	}
	var target models.User
	// Search rules:
	// - username#1234 exact match (case-insensitive on username, exact 4 digits discriminator)
	// - email exact match (case-insensitive)
	// - anything else -> not found (forces uniqueness and reliability)
	var err error
	if parts := strings.Split(q, "#"); len(parts) == 2 && len(parts[1]) == 4 {
		name := strings.TrimSpace(parts[0])
		disc := strings.TrimSpace(parts[1])
		if name == "" {
			return nil, gorm.ErrRecordNotFound
		}
		err = s.db.Where("LOWER(username) = LOWER(?) AND discriminator = ?", name, disc).First(&target).Error
	} else if strings.Contains(q, "@") {
		err = s.db.Where("LOWER(email) = LOWER(?)", q).First(&target).Error
	} else {
		return nil, gorm.ErrRecordNotFound
	}
	if err != nil {
		return nil, err
	}
	if target.ID == fromUserID {
		return nil, errors.New("cannot send request to self")
	}
	// Already friends?
	var cnt int64
	if err := s.db.Table("friendships").
		Where("user_id = ? AND friend_id = ?", fromUserID, target.ID).
		Count(&cnt).Error; err != nil {
		return nil, err
	}
	if cnt > 0 {
		return nil, errors.New("already friends")
	}
	// Existing pending in either direction?
	var existing models.FriendRequest
	err = s.db.Where(
		"status = ? AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))",
		"pending", fromUserID, target.ID, target.ID, fromUserID,
	).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	req := &models.FriendRequest{
		ID:         uuid.New().String(),
		SenderID: fromUserID,
		ReceiverID:   target.ID,
		Status:     "pending",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	if err := s.db.Create(req).Error; err != nil {
		return nil, err
	}
	if err := s.db.Preload("Sender").Preload("Receiver").First(req, "id = ?", req.ID).Error; err != nil {
		return req, nil
	}
	return req, nil
}

func (s *MessageService) GetFriendRequests(userID string) (incoming []models.FriendRequest, outgoing []models.FriendRequest, err error) {
    // Входящие заявки (пользователь - получатель)
    if err = s.db.Where("receiver_id = ? AND status = ?", userID, "pending").
        Preload("Sender").      // ← Используем Sender
        Preload("Receiver").    // ← Используем Receiver  
        Order("created_at DESC").
        Find(&incoming).Error; err != nil {
        return nil, nil, err
    }
    
    // Исходящие заявки (пользователь - отправитель)
    if err = s.db.Where("sender_id = ? AND status = ?", userID, "pending").
        Preload("Sender").      // ← Используем Sender
        Preload("Receiver").    // ← Используем Receiver
        Order("created_at DESC").
        Find(&outgoing).Error; err != nil {
        return nil, nil, err
    }
    
    return incoming, outgoing, nil
}

func (s *MessageService) AcceptFriendRequest(userID, requestID string) (*models.FriendRequest, error) {
	var req models.FriendRequest
	if err := s.db.First(&req, "id = ?", requestID).Error; err != nil {
		return nil, err
	}
	if req.ReceiverID != userID {
		return nil, errors.New("forbidden")
	}
	if req.Status != "pending" {
		return nil, errors.New("request is not pending")
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&req).Updates(map[string]any{"status": "accepted", "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		pairs := []models.Friendship{
			{UserID: req.SenderID, FriendID: req.ReceiverID, CreatedAt: time.Now()},
			{UserID: req.ReceiverID, FriendID: req.SenderID, CreatedAt: time.Now()},
		}
		for _, p := range pairs {
			var c int64
			if err := tx.Table("friendships").Where("user_id = ? AND friend_id = ?", p.UserID, p.FriendID).Count(&c).Error; err != nil {
				return err
			}
			if c == 0 {
				if err := tx.Create(&p).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return &req, nil
}

func (s *MessageService) DeclineFriendRequest(userID, requestID string) (*models.FriendRequest, error) {
	var req models.FriendRequest
	if err := s.db.First(&req, "id = ?", requestID).Error; err != nil {
		return nil, err
	}
	if req.ReceiverID != userID {
		return nil, errors.New("forbidden")
	}
	if req.Status != "pending" {
		return nil, errors.New("request is not pending")
	}
	if err := s.db.Model(&req).Updates(map[string]any{"status": "declined", "updated_at": time.Now()}).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

func (s *MessageService) CancelFriendRequest(userID, requestID string) (*models.FriendRequest, error) {
	var req models.FriendRequest
	if err := s.db.First(&req, "id = ?", requestID).Error; err != nil {
		return nil, err
	}
	if req.SenderID != userID {
		return nil, errors.New("forbidden")
	}
	if req.Status != "pending" {
		return nil, errors.New("request is not pending")
	}
	if err := s.db.Model(&req).Updates(map[string]any{"status": "canceled", "updated_at": time.Now()}).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

func (s *MessageService) AddGroupMember(groupID, userID, role string) error {
	member := &models.GroupMember{
		GroupID:  groupID,
		UserID:   userID,
		Role:     role,
		JoinedAt: time.Now(),
	}
	return s.db.Create(member).Error
}

// UpdateGroupConversation updates name/avatar for a group the actor belongs to.
func (s *MessageService) UpdateGroupConversation(actorID, convID string, name *string, avatar *string) (*models.Conversation, error) {
	ok, err := s.IsUserInConversation(actorID, convID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotParticipant
	}
	var conv models.Conversation
	if err := s.db.First(&conv, "id = ?", convID).Error; err != nil {
		return nil, err
	}
	if !conv.IsGroup {
		return nil, errors.New("only group conversations can be edited")
	}
	updates := map[string]interface{}{}
	if name != nil {
		updates["name"] = strings.TrimSpace(*name)
	}
	if avatar != nil {
		updates["avatar"] = *avatar
	}
	if len(updates) == 0 {
		var full models.Conversation
		if err := s.db.Preload("Participants").First(&full, "id = ?", convID).Error; err != nil {
			return nil, err
		}
		return &full, nil
	}
	updates["updated_at"] = time.Now()
	if err := s.db.Model(&conv).Updates(updates).Error; err != nil {
		return nil, err
	}
	var full models.Conversation
	if err := s.db.Preload("Participants").First(&full, "id = ?", convID).Error; err != nil {
		return &conv, nil
	}
	return &full, nil
}

// RemoveFromGroup removes a participant from a group conversation (kick or leave).
// AddGroupParticipants adds users to a group conversation (actor must be a participant).
func (s *MessageService) AddGroupParticipants(actorID, convID string, userIDs []string) (*models.Conversation, error) {
	ok, err := s.IsUserInConversation(actorID, convID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotParticipant
	}
	var conv models.Conversation
	if err := s.db.First(&conv, "id = ?", convID).Error; err != nil {
		return nil, err
	}
	if !conv.IsGroup {
		return nil, errors.New("not a group chat")
	}
	for _, uid := range userIDs {
		if uid == "" {
			continue
		}
		in, _ := s.IsUserInConversation(uid, convID)
		if in {
			continue
		}
		var u models.User
		if err := s.db.First(&u, "id = ?", uid).Error; err != nil {
			continue
		}
		if err := s.db.Model(&conv).Association("Participants").Append(&u); err != nil {
			return nil, err
		}
	}
	s.db.Model(&conv).Update("updated_at", time.Now())
	var full models.Conversation
	if err := s.db.Preload("Participants").First(&full, "id = ?", convID).Error; err != nil {
		return &conv, nil
	}
	return &full, nil
}

func (s *MessageService) RemoveFromGroup(actorID, convID, targetUserID string) error {
	ok, err := s.IsUserInConversation(actorID, convID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotParticipant
	}
	var conv models.Conversation
	if err := s.db.First(&conv, "id = ?", convID).Error; err != nil {
		return err
	}
	if !conv.IsGroup {
		return errors.New("not a group chat")
	}
	okTarget, _ := s.IsUserInConversation(targetUserID, convID)
	if !okTarget {
		return errors.New("user not in group")
	}
	return s.db.Table("conversation_participants").
		Where("conversation_id = ? AND user_id = ?", convID, targetUserID).
		Delete(nil).Error
}
