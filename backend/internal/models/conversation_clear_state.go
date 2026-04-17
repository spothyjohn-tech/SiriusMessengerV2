package models

import "time"

// ConversationClearState stores per-user "clear history" for a conversation (client view sync).
type ConversationClearState struct {
	UserID         string    `gorm:"primaryKey;type:varchar(36)" json:"-"`
	ConversationID string    `gorm:"primaryKey;type:varchar(36)" json:"-"`
	ClearedAt      time.Time `gorm:"not null" json:"clearedAt"`
}

func (ConversationClearState) TableName() string {
	return "conversation_clear_states"
}
