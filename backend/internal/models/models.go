package models

import (
	"time"
)

type User struct {
	ID                  string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	Username            string    `gorm:"uniqueIndex:uniq_username_discriminator;index;not null" json:"username"`
	Discriminator       string    `gorm:"index;not null;type:varchar(4);uniqueIndex:uniq_username_discriminator;default:'0000'" json:"discriminator"`
	Email               string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash        string    `gorm:"not null" json:"-"`
	PublicKey           string    `gorm:"type:text;not null" json:"publicKey"`
	PrivateKeyEncrypted string    `gorm:"type:text;not null" json:"-"`
	Avatar              string    `json:"avatar"`
	Online              bool      `gorm:"default:false" json:"online"`
	LastSeen            time.Time `json:"lastSeen"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	TokenVersion        int       `gorm:"default:0" json:"-"`
}

type Message struct {
	ID               string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	ConversationID   string    `gorm:"index;not null;type:varchar(36)" json:"conversationId"`
	SenderID         string    `gorm:"not null;type:varchar(36)" json:"senderId"`
	EncryptedContent string    `gorm:"type:text;not null" json:"encryptedContent"`
	IV               string    `gorm:"type:text;not null" json:"iv"`
	SenderKey        string    `gorm:"type:text;not null" json:"senderKey"`
	MessageType      string    `gorm:"default:text" json:"messageType"` // text, image, file, call
	IsDeleted        bool      `gorm:"default:false" json:"isDeleted"`
	CreatedAt        time.Time `json:"createdAt"`

	Sender User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
}

type Conversation struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	IsGroup   bool      `gorm:"default:false" json:"isGroup"`
	Name      string    `json:"name"`
	Avatar    string    `json:"avatar"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// MyClearedAt is set in API responses for the current user only (not stored on this row).
	MyClearedAt *time.Time `gorm:"-" json:"myClearedAt,omitempty"`

	Participants []User    `gorm:"many2many:conversation_participants;" json:"participants,omitempty"`
	Messages     []Message `json:"messages,omitempty"`
}

type Group struct {
	ID          string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	Name        string    `gorm:"not null" json:"name"`
	Avatar      string    `json:"avatar"`
	Description string    `json:"description"`
	OwnerID     string    `gorm:"not null;type:varchar(36)" json:"ownerId"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`

	Owner   User          `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Members []GroupMember `json:"members,omitempty"`
}

type GroupMember struct {
	GroupID  string    `gorm:"primaryKey;type:varchar(36)" json:"groupId"`
	UserID   string    `gorm:"primaryKey;type:varchar(36)" json:"userId"`
	Role     string    `gorm:"default:member" json:"role"` // admin, member
	JoinedAt time.Time `json:"joinedAt"`

	Group Group `gorm:"foreignKey:GroupID" json:"-"`
	User  User  `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

type CallSession struct {
	ID              string     `gorm:"primaryKey;type:varchar(36)" json:"id"`
	ConversationID  string     `gorm:"index;type:varchar(36)" json:"conversationId"`
	CallerID        string     `gorm:"type:varchar(36)" json:"callerId"`
	CalleeID        string     `gorm:"type:varchar(36)" json:"calleeId"`
	IsVideo         bool       `gorm:"default:false" json:"isVideo"`
	Status          string     `gorm:"default:initiated" json:"status"` // initiated, connected, ended
	EncryptedOffer  string     `gorm:"type:text" json:"encryptedOffer"`
	EncryptedAnswer string     `gorm:"type:text" json:"encryptedAnswer"`
	StartedAt       time.Time  `json:"startedAt"`
	EndedAt         *time.Time `json:"endedAt,omitempty"`
}

type FriendRequest struct {
	ID         string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	SenderID   string    `gorm:"index;not null;type:varchar(36);column:sender_id" json:"senderId"`
	ReceiverID string    `gorm:"index;not null;type:varchar(36);column:receiver_id" json:"receiverId"`
	Status     string    `gorm:"index;default:pending" json:"status"` // pending, accepted, declined, canceled
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`

	Sender   User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Receiver User `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
}

type Friendship struct {
	UserID    string    `gorm:"primaryKey;type:varchar(36)" json:"-"`
	FriendID  string    `gorm:"primaryKey;type:varchar(36)" json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

type RefreshToken struct {
	ID        string `gorm:"primaryKey;type:varchar(36)"`
	UserID    string `gorm:"index;not null;type:varchar(36)"`
	Token     string `gorm:"uniqueIndex;type:text"`
	ExpiresAt time.Time
	Revoked   bool `gorm:"default:false"`
	CreatedAt time.Time
}

type UploadedFile struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	OwnerID        string    `gorm:"index;not null;type:varchar(36)" json:"ownerId"`
	ConversationID string    `gorm:"index;not null;type:varchar(36)" json:"conversationId"`
	OriginalName   string    `gorm:"not null" json:"originalName"`
	MimeType       string    `gorm:"not null" json:"mimeType"`
	SizeBytes      int64     `gorm:"not null" json:"sizeBytes"`
	StoragePath    string    `gorm:"not null" json:"-"`
	Nonce          string    `gorm:"type:text;not null" json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// UserBlock represents a "recipient blocks sender" relation.
// If a user A blocks user B, then B must not be able to send messages/signaling to A.
type UserBlock struct {
	BlockerID string    `gorm:"primaryKey;type:varchar(36);index" json:"blockerId"`
	BlockedID string    `gorm:"primaryKey;type:varchar(36);index" json:"blockedId"`
	CreatedAt time.Time `json:"createdAt"`
}
