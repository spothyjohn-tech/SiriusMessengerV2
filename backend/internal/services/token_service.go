package services

import (
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "errors"
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
        Token:     hashRefreshToken(token),
        ExpiresAt: expiresAt,
        Revoked:   false,
        CreatedAt: time.Now(),
    }
    return s.db.Create(rt).Error
}

func (s *TokenService) ValidateRefreshToken(token string) (*models.RefreshToken, error) {
    var rt models.RefreshToken
    now := time.Now()

    // New format: store hashed refresh tokens.
    hashed := hashRefreshToken(token)
    err := s.db.Where("token = ? AND revoked = ? AND expires_at > ?", hashed, false, now).First(&rt).Error
    if err == nil {
        return &rt, nil
    }

    // Backward compatibility: older rows stored raw tokens.
    err = s.db.Where("token = ? AND revoked = ? AND expires_at > ?", token, false, now).First(&rt).Error
    if err != nil {
        return nil, err
    }
    return &rt, nil
}

func (s *TokenService) RevokeRefreshToken(token string) error {
    // Revoke both potential representations (hashed + raw) for a smoother migration.
    hashed := hashRefreshToken(token)
    return s.db.Model(&models.RefreshToken{}).
        Where("token = ? OR token = ?", hashed, token).
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

// RotateRefreshToken revokes the old refresh token and stores the new one atomically.
func (s *TokenService) RotateRefreshToken(userID, oldToken, newToken string, newExpiresAt time.Time) error {
    if userID == "" || oldToken == "" || newToken == "" {
        return errors.New("missing inputs")
    }
    return s.db.Transaction(func(tx *gorm.DB) error {
        // Ensure the old token is currently valid (and belongs to the same user).
        var rt models.RefreshToken
        now := time.Now()
        hashedOld := hashRefreshToken(oldToken)
        err := tx.Where(
            "user_id = ? AND (token = ? OR token = ?) AND revoked = ? AND expires_at > ?",
            userID, hashedOld, oldToken, false, now,
        ).First(&rt).Error
        if err != nil {
            return err
        }

        // Revoke old.
        if err := tx.Model(&models.RefreshToken{}).
            Where("id = ?", rt.ID).
            Update("revoked", true).Error; err != nil {
            return err
        }

        // Store new.
        nrt := &models.RefreshToken{
            ID:        uuid.New().String(),
            UserID:    userID,
            Token:     hashRefreshToken(newToken),
            ExpiresAt: newExpiresAt,
            Revoked:   false,
            CreatedAt: time.Now(),
        }
        return tx.Create(nrt).Error
    })
}

func hashRefreshToken(token string) string {
    sum := sha256.Sum256([]byte(token))
    return base64.RawURLEncoding.EncodeToString(sum[:])
}