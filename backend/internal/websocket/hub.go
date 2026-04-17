package websocket

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"messenger/internal/crypto"
)

// ConversationParticipantLookup resolves conversation members for targeted broadcast.
type ConversationParticipantLookup interface {
	ParticipantUserIDs(conversationID string) ([]string, error)
}

type Hub struct {
	clients    map[string]*Client
	broadcast  chan *Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	crypto     *crypto.E2EEService
	lookup     ConversationParticipantLookup
}

type Client struct {
	ID     string
	UserID string
	Conn   *websocket.Conn
	Send   chan []byte
	Hub    *Hub
}

type Message struct {
	Type           string      `json:"type"`
	ConversationID string      `json:"conversationId,omitempty"`
	SenderID       string      `json:"senderId"`
	RecipientID    string      `json:"recipientId,omitempty"`
	Payload        interface{} `json:"payload"`
	Timestamp      time.Time   `json:"timestamp"`
}

type WebSocketMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func NewHub(lookup ConversationParticipantLookup, cryptoService *crypto.E2EEService) *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		broadcast:  make(chan *Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		crypto:     cryptoService,
		lookup:     lookup,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.deliver(message)
		}
	}
}

func (h *Hub) deliver(msg *Message) {
	body := h.encodeMessage(msg)

	targetUsers := make(map[string]bool)
	if msg.RecipientID != "" {
		targetUsers[msg.RecipientID] = true
	} else if msg.ConversationID != "" && h.lookup != nil {
		ids, err := h.lookup.ParticipantUserIDs(msg.ConversationID)
		if err != nil {
			return
		}
		for _, id := range ids {
			targetUsers[id] = true
		}
	} else {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.clients {
		if !targetUsers[client.UserID] {
			continue
		}
		if msg.Type == "message" && client.UserID == msg.SenderID {
			continue
		}
		if msg.Type == "typing" && client.UserID == msg.SenderID {
			continue
		}
		if msg.Type == "group-call-invite" && client.UserID == msg.SenderID {
			continue
		}

		select {
		case client.Send <- body:
		default:
		}
	}
}

func (h *Hub) encodeMessage(msg *Message) []byte {
	data, _ := json.Marshal(msg)
	return data
}

func (h *Hub) SendToUser(userID string, message *Message) {
	message.RecipientID = userID
	h.broadcast <- message
}

func (h *Hub) SendToConversation(conversationID string, message *Message) {
	message.ConversationID = conversationID
	h.broadcast <- message
}

// Join registers a connected WebSocket client with the hub.
func (h *Hub) Join(client *Client) {
	h.register <- client
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var wsMsg WebSocketMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			continue
		}

		switch wsMsg.Type {
		// Chat payloads are persisted and pushed via POST /api/messages (not WS relay),
		// so we do not accept arbitrary "message" frames here (avoids spoofing).

		case "typing":
			var typingData struct {
				ConversationID string `json:"conversationId"`
				IsTyping       bool   `json:"isTyping"`
			}
			json.Unmarshal(wsMsg.Data, &typingData)

			c.Hub.broadcast <- &Message{
				Type:           "typing",
				ConversationID: typingData.ConversationID,
				SenderID:       c.UserID,
				Payload: map[string]interface{}{
					"conversationId": typingData.ConversationID,
					"isTyping":       typingData.IsTyping,
					"userId":         c.UserID,
				},
				Timestamp: time.Now(),
			}

		case "call-offer":
			var callData map[string]interface{}
			json.Unmarshal(wsMsg.Data, &callData)

			calleeID, _ := callData["calleeId"].(string)
			if calleeID == "" {
				break
			}

			c.Hub.SendToUser(calleeID, &Message{
				Type:      "call-offer",
				SenderID:  c.UserID,
				Payload:   callData,
				Timestamp: time.Now(),
			})

		case "call-answer":
			var answerData struct {
				ConversationID  string      `json:"conversationId"`
				CallerID        string      `json:"callerId"`
				EncryptedAnswer interface{} `json:"encryptedAnswer"`
			}
			json.Unmarshal(wsMsg.Data, &answerData)

			c.Hub.SendToUser(answerData.CallerID, &Message{
				Type:      "call-answer",
				SenderID:  c.UserID,
				Payload:   answerData,
				Timestamp: time.Now(),
			})

		case "ice-candidate":
			var iceData struct {
				ConversationID string      `json:"conversationId"`
				TargetID       string      `json:"targetId"`
				Candidate      interface{} `json:"candidate"`
			}
			json.Unmarshal(wsMsg.Data, &iceData)

			c.Hub.SendToUser(iceData.TargetID, &Message{
				Type:      "ice-candidate",
				SenderID:  c.UserID,
				Payload:   iceData,
				Timestamp: time.Now(),
			})

		case "group-call-invite":
			var inv struct {
				ConversationID string   `json:"conversationId"`
				CallID         string   `json:"callId"`
				MemberIDs      []string `json:"memberIds"`
			}
			json.Unmarshal(wsMsg.Data, &inv)
			if inv.ConversationID == "" || inv.CallID == "" {
				break
			}
			c.Hub.broadcast <- &Message{
				Type:           "group-call-invite",
				ConversationID: inv.ConversationID,
				SenderID:       c.UserID,
				Payload: map[string]interface{}{
					"conversationId": inv.ConversationID,
					"callId":         inv.CallID,
					"memberIds":      inv.MemberIDs,
					"initiatorId":    c.UserID,
				},
				Timestamp: time.Now(),
			}

		case "group-call-end":
			var end struct {
				ConversationID string `json:"conversationId"`
				CallID         string `json:"callId"`
			}
			json.Unmarshal(wsMsg.Data, &end)
			if end.ConversationID == "" {
				break
			}
			c.Hub.broadcast <- &Message{
				Type:           "group-call-end",
				ConversationID: end.ConversationID,
				SenderID:       c.UserID,
				Payload: map[string]interface{}{
					"conversationId": end.ConversationID,
					"callId":         end.CallID,
				},
				Timestamp: time.Now(),
			}

		case "group-call-kick":
			var kick struct {
				ConversationID string `json:"conversationId"`
				CallID         string `json:"callId"`
				TargetID       string `json:"targetId"`
			}
			json.Unmarshal(wsMsg.Data, &kick)
			if kick.TargetID == "" {
				break
			}
			c.Hub.SendToUser(kick.TargetID, &Message{
				Type:     "group-call-kick",
				SenderID: c.UserID,
				Payload: map[string]interface{}{
					"conversationId": kick.ConversationID,
					"callId":         kick.CallID,
					"targetId":       kick.TargetID,
					"fromUserId":     c.UserID,
				},
				Timestamp: time.Now(),
			})

		case "group-voice-join":
			var j struct {
				ConversationID string `json:"conversationId"`
				CallID         string `json:"callId"`
			}
			json.Unmarshal(wsMsg.Data, &j)
			if j.ConversationID == "" || j.CallID == "" {
				break
			}
			c.Hub.broadcast <- &Message{
				Type:           "group-voice-join",
				ConversationID: j.ConversationID,
				SenderID:       c.UserID,
				Payload: map[string]interface{}{
					"conversationId": j.ConversationID,
					"callId":         j.CallID,
					"userId":         c.UserID,
				},
				Timestamp: time.Now(),
			}

		case "group-voice-leave":
			var l struct {
				ConversationID string `json:"conversationId"`
				CallID         string `json:"callId"`
			}
			json.Unmarshal(wsMsg.Data, &l)
			if l.ConversationID == "" || l.CallID == "" {
				break
			}
			c.Hub.broadcast <- &Message{
				Type:           "group-voice-leave",
				ConversationID: l.ConversationID,
				SenderID:       c.UserID,
				Payload: map[string]interface{}{
					"conversationId": l.ConversationID,
					"callId":         l.CallID,
					"userId":         c.UserID,
				},
				Timestamp: time.Now(),
			}

		case "call-signal":
			var sig struct {
				ConversationID string      `json:"conversationId"`
				TargetID       string      `json:"targetId"`
				Payload        interface{} `json:"payload"`
			}
			json.Unmarshal(wsMsg.Data, &sig)
			if sig.TargetID == "" {
				break
			}
			c.Hub.SendToUser(sig.TargetID, &Message{
				Type:     "call-signal",
				SenderID: c.UserID,
				Payload: map[string]interface{}{
					"conversationId": sig.ConversationID,
					"targetId":       sig.TargetID,
					"fromUserId":     c.UserID,
					"payload":        sig.Payload,
				},
				Timestamp: time.Now(),
			})
		}
	}
}

func (c *Client) WritePump() {
	defer c.Conn.Close()

	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			break
		}
	}
}
