package services

import (
    "crypto/rand"
    "encoding/base64"
    "time"
    
    "github.com/google/uuid"
    "gorm.io/gorm"
    "messenger/internal/models"
)

type TokenService struct {
    db *gorm.DB
}

func NewTokenService(db *gorm.DB) *TokenService {
    return &TokenService{db: db}
}

func (s *TokenService) SaveRefreshToken(userID, token string, expiresAt time.Time) error {
    rt := &models.RefreshToken{
        ID:        uuid.New().String(),
        UserID:    userID,
        Token:     token,
        ExpiresAt: expiresAt,
        Revoked:   false,
        CreatedAt: time.Now(),
    }
    return s.db.Create(rt).Error
}

func (s *TokenService) ValidateRefreshToken(token string) (*models.RefreshToken, error) {
    var rt models.RefreshToken
    err := s.db.Where("token = ? AND revoked = ? AND expires_at > ?", 
        token, false, time.Now()).First(&rt).Error
    if err != nil {
        return nil, err
    }
    return &rt, nil
}

func (s *TokenService) RevokeRefreshToken(token string) error {
    return s.db.Model(&models.RefreshToken{}).
        Where("token = ?", token).
        Update("revoked", true).Error
}

func (s *TokenService) RevokeAllUserTokens(userID string) error {
    return s.db.Model(&models.RefreshToken{}).
        Where("user_id = ?", userID).
        Update("revoked", true).Error
}

func (s *TokenService) CleanupExpiredTokens() error {
    return s.db.Where("expires_at < ?", time.Now()).Delete(&models.RefreshToken{}).Error
}

func generateSecureToken() string {
    bytes := make([]byte, 32)
    rand.Read(bytes)
    return base64.URLEncoding.EncodeToString(bytes)
}