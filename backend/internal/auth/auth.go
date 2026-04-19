package auth

import (
"crypto/rand"
    "encoding/base64"
    "errors"
    "fmt"
    "os"
    "runtime"
    "strings"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
    "golang.org/x/crypto/argon2"
    "gorm.io/gorm"

    "messenger/internal/models"
    "messenger/internal/services"

)

type AuthService struct {
    db       *gorm.DB
    jwtSecret []byte
    tokenService *services.TokenService
}

type Claims struct {
    UserID string `json:"userId"`
    TokenType string `json:"tokenType"` // "access" or "refresh"
    TokenVersion int    `json:"tokenVersion"`
    jwt.RegisteredClaims
}

type Argon2Config struct {
    Time    uint32 // Количество итераций
    Memory  uint32 // Память в KB
    Threads uint8  // Количество потоков
    KeyLen  uint32 // Длина ключа
}


func NewAuthService(db *gorm.DB, tokenService *services.TokenService, secret []byte) *AuthService {
    // secret := os.Getenv("MESSENGER_JWT_SECRET")
    // if secret == "" {
    //     // В production - паникуем или генерируем и сохраняем
    //     if os.Getenv("ENVIRONMENT") == "production" {
    //         panic("MESSENGER_JWT_SECRET must be set in production")
    //     }
        
    //     // В development - генерируем случайный ключ
    //     secret = generateSecureSecret()
    //     //log.Printf("WARNING: Using generated JWT secret for development")
    //     os.Setenv("MESSENGER_JWT_SECRET", secret)
    // }
    
    // Проверяем минимальную длину секрета
    if len(secret) < 32 {
        panic("JWT secret must be at least 32 characters long")
    }
    
     return &AuthService{
        db:           db,
        jwtSecret:    secret,
        tokenService: tokenService,
    }

}

func generateSecureSecret() string {
    bytes := make([]byte, 32)
    if _, err := rand.Read(bytes); err != nil {
        panic("failed to generate secure secret: " + err.Error())
    }
    return base64.URLEncoding.EncodeToString(bytes)
}

// func (s *AuthService) Register(username, email, password, publicKey string) (*models.User, error) {
//     // Check if user exists
//     var existingUser models.User
// 	if err := s.db.Where("email = ?", email).First(&existingUser).Error; err == nil {
//         return nil, errors.New("user already exists")
//     }
    
//     // Hash password with Argon2
//     salt := make([]byte, 16)
//     rand.Read(salt)
//     hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
    
//     // Store salt + hash
//     passwordHash := base64.StdEncoding.EncodeToString(salt) + ":" + base64.StdEncoding.EncodeToString(hash)
    
// 	var disc string
// 	if err := s.db.Transaction(func(tx *gorm.DB) error {
// 		d, err := allocateDiscriminator(tx, username)
// 		if err != nil {
// 			return err
// 		}
// 		disc = d
// 		return nil
// 	}); err != nil {
// 		return nil, err
// 	}

// 	user := &models.User{
//         ID:                  generateID(),
//         Username:            username,
// 		Discriminator:       disc,
//         Email:               email,
//         PasswordHash:        passwordHash,
//         PublicKey:           publicKey,
//         PrivateKeyEncrypted: "",
//         CreatedAt:           time.Now(),
//         UpdatedAt:           time.Now(),
//     }
    
//     if err := s.db.Create(user).Error; err != nil {
//         return nil, err
//     }
    
//     return user, nil
// }

func allocateDiscriminator(tx *gorm.DB, username string) (string, error) {
	// Pick the lowest available 0001..9999 for this username.
	var used []string
	if err := tx.Model(&models.User{}).Where("username = ?", username).Pluck("discriminator", &used).Error; err != nil {
		return "", err
	}
	seen := map[string]bool{}
	for _, u := range used {
		if len(u) == 4 {
			seen[u] = true
		}
	}
	for i := 1; i <= 9999; i++ {
		d := fmt.Sprintf("%04d", i)
		if !seen[d] {
			return d, nil
		}
	}
	return "", errors.New("no discriminator slots available for this username")
}

// BackfillDiscriminators assigns discriminators to existing users missing them.
func (s *AuthService) BackfillDiscriminators() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var users []models.User
		if err := tx.Where("discriminator = '' OR discriminator IS NULL").Order("created_at ASC").Find(&users).Error; err != nil {
			return err
		}
		for _, u := range users {
			d, err := allocateDiscriminator(tx, u.Username)
			if err != nil {
				return err
			}
			if err := tx.Model(&models.User{}).Where("id = ?", u.ID).Update("discriminator", d).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// func (s *AuthService) Login(email, password string) (string, string, error) {
//     var user models.User
//     if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
//         return "", "", errors.New("invalid credentials")
//     }
    
//     // Verify password
//     parts := splitHash(user.PasswordHash)
//     if len(parts) != 2 {
//         return "", "", errors.New("invalid password hash")
//     }
    
//     salt, _ := base64.StdEncoding.DecodeString(parts[0])
//     storedHash, _ := base64.StdEncoding.DecodeString(parts[1])
    
//     hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
//     if !compareHash(hash, storedHash) {
//         return "", "", errors.New("invalid credentials")
//     }
    
//     // Generate tokens
//     accessToken, err := s.generateToken(user.ID, 15*time.Minute)
//     if err != nil {
//         return "", "", err
//     }
    
//     refreshToken, err := s.generateToken(user.ID, 7*24*time.Hour)
//     if err != nil {
//         return "", "", err
//     }
    
//     // Update user status
//     s.db.Model(&user).Update("online", true)
    
//     return accessToken, refreshToken, nil
// }

// func (s *AuthService) ValidateToken(tokenString string) (*Claims, error) {
//     token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
//         return s.jwtSecret, nil
//     })
    
//     if err != nil {
//         return nil, err
//     }
    
//     if claims, ok := token.Claims.(*Claims); ok && token.Valid {
//         return claims, nil
//     }
    
//     return nil, errors.New("invalid token")
// }

func (s *AuthService) generateToken(userID string, expiration time.Duration, tokenType string) (string, error) {
 var user models.User
    if err := s.db.Select("token_version").First(&user, "id = ?", userID).Error; err != nil {
        return "", err
    }
    
    claims := &Claims{
        UserID:       userID,
        TokenType:    tokenType,
        TokenVersion: user.TokenVersion,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiration)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            NotBefore: jwt.NewNumericDate(time.Now()),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(s.jwtSecret)
}

func (s *AuthService) ValidateToken(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return s.jwtSecret, nil
    })
    
    if err != nil {
        return nil, err
    }
    
    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        // Проверяем версию токена
        var user models.User
        if err := s.db.Select("token_version").First(&user, "id = ?", claims.UserID).Error; err != nil {
            return nil, errors.New("user not found")
        }
        
        if claims.TokenVersion != user.TokenVersion {
            return nil, errors.New("token revoked")
        }
        
        return claims, nil
    }
    
    return nil, errors.New("invalid token")
}

func (s *AuthService) ChangePassword(userID, oldPassword, newPassword string) error {
    var user models.User
    if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
        return err
    }
    
    // Используем verifyPassword вместо прямого разбора
    if !s.verifyPassword(oldPassword, user.PasswordHash) {
        return errors.New("invalid old password")
    }
    
    // Хешируем новый пароль с актуальными параметрами
    config := getArgon2Config()
    newSalt := make([]byte, 16)
    if _, err := rand.Read(newSalt); err != nil {
        return err
    }
    
    newHash := argon2.IDKey(
        []byte(newPassword), 
        newSalt, 
        config.Time,
        config.Memory,
        config.Threads,
        config.KeyLen,
    )
    
    newPasswordHash := fmt.Sprintf("%d:%d:%s:%s",
        config.Time,
        config.Memory,
        base64.StdEncoding.EncodeToString(newSalt),
        base64.StdEncoding.EncodeToString(newHash),
    )
    
    // Обновляем пароль, инкрементируем версию токена и отзываем все refresh токены
    return s.db.Transaction(func(tx *gorm.DB) error {
        if err := tx.Model(&user).Updates(map[string]interface{}{
            "password_hash": newPasswordHash,
            "token_version": gorm.Expr("token_version + 1"),
            "updated_at":    time.Now(),
        }).Error; err != nil {
            return err
        }
        
        // Отзываем все refresh токены пользователя
        return tx.Model(&models.RefreshToken{}).
            Where("user_id = ?", userID).
            Update("revoked", true).Error
    })
}

func (s *AuthService) GetUserByID(id string) (*models.User, error) {
    var user models.User
    if err := s.db.First(&user, "id = ?", id).Error; err != nil {
        return nil, err
    }
    return &user, nil
}

func (s *AuthService) GetUserByEmail(email string) (*models.User, error) {
    var user models.User
    if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
        return nil, err
    }
    return &user, nil
}

func (s *AuthService) SetUserOffline(userID string) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("online", false).Error
}

// UpdateProfile updates username and/or avatar for the given user. Empty avatar string clears it.
func (s *AuthService) UpdateProfile(userID string, username *string, avatar *string) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	updates := map[string]interface{}{}
	if username != nil {
		u := strings.TrimSpace(*username)
		if u == "" {
			return nil, errors.New("username cannot be empty")
		}
		if u != user.Username {
			// Username is no longer globally unique; allocate a new discriminator within the new username.
			d, err := allocateDiscriminator(s.db, u)
			if err != nil {
				return nil, err
			}
			updates["username"] = u
			updates["discriminator"] = d
		}
	}
	if avatar != nil {
		updates["avatar"] = *avatar
	}
	if len(updates) == 0 {
		return &user, nil
	}
	updates["updated_at"] = time.Now()
	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		return nil, err
	}
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// RefreshAccessToken issues a new access token from a valid refresh JWT.
func (s *AuthService) RefreshAccessToken(refreshToken string) (string, error) {
    rt, err := s.tokenService.ValidateRefreshToken(refreshToken)
    if err != nil {
        return "", errors.New("invalid or expired refresh token")
    }

    claims, err := s.ValidateToken(refreshToken)
    if err != nil {
        return "", err
    }
     if claims.TokenType != "refresh" {
        return "", errors.New("invalid token type")
    }
     // Проверяем что userID совпадает
    if claims.UserID != rt.UserID {
        return "", errors.New("token user mismatch")
    }
    return s.generateToken(claims.UserID, 15*time.Minute, "access")
}

func (s *AuthService) Logout(refreshToken string) error {
    return s.tokenService.RevokeRefreshToken(refreshToken)
}

// Добавляем метод для logout со всех устройств
func (s *AuthService) LogoutAll(userID string) error {
    // Отзываем все refresh токены
    if err := s.tokenService.RevokeAllUserTokens(userID); err != nil {
        return err
    }
    
    // Инкрементируем версию токена чтобы отозвать все access токены
    return s.db.Model(&models.User{}).
        Where("id = ?", userID).
        Update("token_version", gorm.Expr("token_version + 1")).Error
}



// AuthMiddleware validates Bearer JWT and sets userId on the Gin context.
func AuthMiddleware(s *AuthService) gin.HandlerFunc {
    return func(c *gin.Context) {
        h := c.GetHeader("Authorization")
        if h == "" {
            c.AbortWithStatusJSON(401, gin.H{"error": "missing authorization header"})
            return
        }
        const prefix = "Bearer "
        if !strings.HasPrefix(h, prefix) {
            c.AbortWithStatusJSON(401, gin.H{"error": "invalid authorization header"})
            return
        }
        token := strings.TrimSpace(strings.TrimPrefix(h, prefix))
        claims, err := s.ValidateToken(token)
        if err != nil {
            c.AbortWithStatusJSON(401, gin.H{"error": "invalid or expired token"})
            return
        }
        c.Set("userId", claims.UserID)
        c.Next()
    }
}

func generateID() string {
    bytes := make([]byte, 16)
    rand.Read(bytes)
    return base64.RawURLEncoding.EncodeToString(bytes)
}

func splitHash(hash string) []string {
    for i := 0; i < len(hash); i++ {
        if hash[i] == ':' {
            return []string{hash[:i], hash[i+1:]}
        }
    }
    return nil
}

func compareHash(a, b []byte) bool {
    if len(a) != len(b) {
        return false
    }
    for i := range a {
        if a[i] != b[i] {
            return false
        }
    }
    return true
}

func getArgon2Config() Argon2Config {
    // Получаем конфигурацию из env или используем безопасные значения по умолчанию
    config := Argon2Config{
        Time:    3,        // 3 итерации
        Memory:  128 * 1024, // 128 MB
        Threads: uint8(runtime.NumCPU()),
        KeyLen:  32,
    }
    
    // Позволяем переопределить через env для тестирования
    if envTime := os.Getenv("ARGON2_TIME"); envTime != "" {
        fmt.Sscanf(envTime, "%d", &config.Time)
    }
    if envMem := os.Getenv("ARGON2_MEMORY"); envMem != "" {
        fmt.Sscanf(envMem, "%d", &config.Memory)
    }
    
    return config
}

func (s *AuthService) Register(username, email, password, publicKey string) (*models.User, error) {
    // Check if user exists
     var existingUser models.User
	if err := s.db.Where("email = ?", email).First(&existingUser).Error; err == nil { 
        return nil, errors.New("user already exists")
    }
    // Хеширование пароля с улучшенными параметрами Argon2
    config := getArgon2Config()
    salt := make([]byte, 16)
    if _, err := rand.Read(salt); err != nil {
        return nil, err
    }
    
    hash := argon2.IDKey(
        []byte(password), 
        salt, 
        config.Time,
        config.Memory,
        config.Threads,
        config.KeyLen,
    )
    
    // Сохраняем параметры вместе с хешем для возможности будущего обновления
    passwordHash := fmt.Sprintf("%d:%d:%s:%s",
        config.Time,
        config.Memory,
        base64.StdEncoding.EncodeToString(salt),
        base64.StdEncoding.EncodeToString(hash),
    )
    
    var disc string
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		d, err := allocateDiscriminator(tx, username)
		if err != nil {
			return err
		}
		disc = d
		return nil
	}); err != nil {
		return nil, err
	}

	user := &models.User{
        ID:                  generateID(),
        Username:            username,
		Discriminator:       disc,
        Email:               email,
        PasswordHash:        passwordHash,
        PublicKey:           publicKey,
        PrivateKeyEncrypted: "",
        CreatedAt:           time.Now(),
        UpdatedAt:           time.Now(),
    }
    
    if err := s.db.Create(user).Error; err != nil {
        return nil, err
    }
    
    return user, nil
}

func (s *AuthService) Login(email, password string) (string, string, error) {
    var user models.User
    if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
        return "", "", errors.New("invalid credentials")
    }
    
    // Проверяем пароль с поддержкой старого формата
    if !s.verifyPassword(password, user.PasswordHash) {
        return "", "", errors.New("invalid credentials")
    }
    
    // Проверяем, не нужно ли обновить хеш (если параметры устарели)
    if s.needsPasswordRehash(user.PasswordHash) {
        go s.rehashPasswordAsync(user.ID, password) // Асинхронно обновляем хеш
    }
    
    // Генерируем токены
    accessToken, err := s.generateToken(user.ID, 15*time.Minute, "access")
    if err != nil {
        return "", "", err
    }
    
    refreshToken, err := s.generateToken(user.ID, 7*24*time.Hour, "refresh")
    if err != nil {
        return "", "", err
    }
    // Сохраняем refresh token в БД
    if err := s.tokenService.SaveRefreshToken(user.ID, refreshToken, time.Now().Add(7*24*time.Hour)); err != nil {
        return "", "", err
    }
    
    // Обновляем статус пользователя
    s.db.Model(&user).Updates(map[string]interface{}{
        "online":    true,
        "last_seen": time.Now(),
    })
    
    return accessToken, refreshToken, nil
}

func (s *AuthService) verifyPassword(password, storedHash string) bool {
    // Поддержка нового формата: time:memory:salt:hash
    parts := strings.Split(storedHash, ":")
    if len(parts) == 4 {
        // Новый формат
        var time, memory uint32
        fmt.Sscanf(parts[0], "%d", &time)
        fmt.Sscanf(parts[1], "%d", &memory)
        salt, _ := base64.StdEncoding.DecodeString(parts[2])
        expectedHash, _ := base64.StdEncoding.DecodeString(parts[3])
        
        config := getArgon2Config()
        hash := argon2.IDKey([]byte(password), salt, time, memory, config.Threads, uint32(len(expectedHash)))
        return compareHash(hash, expectedHash)
    }
    
    // Старый формат: salt:hash
    if len(parts) == 2 {
        salt, _ := base64.StdEncoding.DecodeString(parts[0])
        expectedHash, _ := base64.StdEncoding.DecodeString(parts[1])
        
        // Используем старые параметры
        hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
        return compareHash(hash, expectedHash)
    }
    
    return false
}

func (s *AuthService) needsPasswordRehash(storedHash string) bool {
    parts := strings.Split(storedHash, ":")
    if len(parts) != 4 {
        return true // Старый формат - нужно обновить
    }
    
    var time, memory uint32
    fmt.Sscanf(parts[0], "%d", &time)
    fmt.Sscanf(parts[1], "%d", &memory)
    
    config := getArgon2Config()
    return time != config.Time || memory != config.Memory
}

func (s *AuthService) rehashPasswordAsync(userID, password string) {
    config := getArgon2Config()
    salt := make([]byte, 16)
    rand.Read(salt)
    
    hash := argon2.IDKey([]byte(password), salt, config.Time, config.Memory, config.Threads, config.KeyLen)
    
    newHash := fmt.Sprintf("%d:%d:%s:%s",
        config.Time,
        config.Memory,
        base64.StdEncoding.EncodeToString(salt),
        base64.StdEncoding.EncodeToString(hash),
    )
    
    s.db.Model(&models.User{}).Where("id = ?", userID).Update("password_hash", newHash)
}