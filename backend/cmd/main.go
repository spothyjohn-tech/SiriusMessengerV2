package main

import (
	"encoding/base64"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"messenger/internal/auth"
	appcrypto "messenger/internal/crypto"
	"messenger/internal/handlers"
	"messenger/internal/middleware"
	"messenger/internal/models"
	"messenger/internal/services"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Ошибка загрузки .env файла")
	}
	jwtSecret := []byte(os.Getenv("MESSENGER_JWT_SECRET"))
	validateFileEncryptionConfig()
	// Initialize database
	db := initDB()

	// Auto migrate
	db.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.Group{},
		&models.GroupMember{},
		&models.Conversation{},
		&models.ConversationClearState{},
		&models.FriendRequest{},
		&models.Friendship{},
		&models.RefreshToken{}, // Добавляем миграцию для RefreshToken
		&models.UploadedFile{},
		&models.UserBlock{},
	)
	normalizeUserIndexes(db)

	// Initialize services
	tokenService := services.NewTokenService(db)                    // Сначала создаем tokenService
	authService := auth.NewAuthService(db, tokenService, jwtSecret) // Затем передаем его в authService

	// Запускаем фоновую очистку токенов
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := tokenService.CleanupExpiredTokens(); err != nil {
				log.Printf("Failed to cleanup expired tokens: %v", err)
			}
		}
	}()

	if err := authService.BackfillDiscriminators(); err != nil {
		log.Println("Failed to backfill discriminators:", err)
	}

	cryptoService := appcrypto.NewE2EEService()
	messageService := services.NewMessageService(db, cryptoService)
	wsHub := websocket.NewHub(messageService, cryptoService)

	// Start WebSocket hub
	go wsHub.Run()

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(authService)
	messageHandler := handlers.NewMessageHandler(messageService, wsHub, db)
	wsHandler := handlers.NewWebSocketHandler(wsHub, authService)

	// Setup router
	router := gin.Default()

	// CORS
	router.Use(corsMiddleware())

	// Public routes
	api := router.Group("/api")
	{
		api.POST("/auth/register", middleware.RegisterRateLimit(), authHandler.Register)
		api.POST("/auth/login", middleware.LoginRateLimit(), authHandler.Login)
		api.POST("/auth/refresh", authHandler.RefreshToken)
	}

	// Protected routes
	protected := api.Group("/")
	protected.Use(auth.AuthMiddleware(authService))
	{
		protected.POST("/auth/logout", authHandler.Logout)
		protected.POST("/auth/logout-all", authHandler.LogoutAll)
		protected.PUT("/auth/private-key-backup", authHandler.UpsertPrivateKeyBackup)
		protected.POST("/auth/change-password", authHandler.ChangePassword)

		protected.GET("/users", messageHandler.GetUsers)
		protected.POST("/users/:userId/block", messageHandler.BlockUser)
		protected.DELETE("/users/:userId/block", messageHandler.UnblockUser)
		protected.GET("/friends", messageHandler.GetFriends)
		protected.DELETE("/friends/:userId", messageHandler.RemoveFriend)
		protected.GET("/friend-requests", messageHandler.GetFriendRequests)
		protected.POST("/friend-requests", messageHandler.SendFriendRequest)
		protected.POST("/friend-requests/:requestId/accept", messageHandler.AcceptFriendRequest)
		protected.POST("/friend-requests/:requestId/decline", messageHandler.DeclineFriendRequest)
		protected.POST("/friend-requests/:requestId/cancel", messageHandler.CancelFriendRequest)
		protected.PATCH("/users/me", authHandler.UpdateMe)
		protected.GET("/conversations", messageHandler.GetConversations)
		protected.POST("/conversations", messageHandler.CreateConversation)
		protected.PATCH("/conversations/:conversationId", messageHandler.UpdateConversation)
		protected.POST("/conversations/:conversationId/clear-history", messageHandler.ClearConversationHistory)
		protected.POST("/conversations/:conversationId/participants", messageHandler.AddConversationParticipants)
		protected.DELETE("/conversations/:conversationId/participants/:userId", messageHandler.RemoveConversationParticipant)
		protected.GET("/messages/:conversationId", messageHandler.GetMessages)
		protected.POST("/messages", messageHandler.SendMessage)
		protected.POST("/messages/upload", messageHandler.UploadMessageFile)
		protected.POST("/files", messageHandler.UploadFile)
		protected.GET("/files/:fileId", messageHandler.DownloadFile)
		protected.PATCH("/conversations/:conversationId/messages/:messageId", messageHandler.UpdateMessage)
		protected.DELETE("/conversations/:conversationId/messages/:messageId", messageHandler.DeleteMessage)
		protected.POST("/groups", messageHandler.CreateGroup)
		protected.POST("/groups/:groupId/members", messageHandler.AddGroupMember)
		protected.POST("/call/offer", messageHandler.HandleCallOffer)
		protected.POST("/call/answer", messageHandler.HandleCallAnswer)
		protected.POST("/call/ice-candidate", messageHandler.HandleICECandidate)
	}

	// WebSocket
	router.GET("/ws", wsHandler.HandleWebSocket)

	// Start server
	go func() {
		if err := router.Run(":8080"); err != nil {
			log.Fatal("Failed to start server:", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
}

func initDB() *gorm.DB {
	dbType := os.Getenv("DB_TYPE")
	if dbType == "" {
		dbType = "sqlite"
	}

	var dialector gorm.Dialector
	switch dbType {
	case "postgres":
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			dsn = "host=localhost user=postgres password=postgres dbname=messenger port=5432 sslmode=disable"
		}
		dialector = postgres.Open(dsn)
	default:
		dialector = sqlite.Open("messenger.db")
	}

	db, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	return db
}

// normalizeUserIndexes removes legacy unique index on users.username.
// Current schema uses a composite unique key: (username, discriminator).
func normalizeUserIndexes(db *gorm.DB) {
	switch db.Dialector.Name() {
	case "sqlite":
		type idxRow struct {
			Seq    int    `gorm:"column:seq"`
			Name   string `gorm:"column:name"`
			Unique int    `gorm:"column:unique"`
			Origin string `gorm:"column:origin"`
		}
		var indexes []idxRow
		if err := db.Raw("PRAGMA index_list('users')").Scan(&indexes).Error; err != nil {
			log.Println("index_list(users) failed:", err)
			return
		}
		for _, idx := range indexes {
			if idx.Unique != 1 || strings.TrimSpace(idx.Name) == "" {
				continue
			}
			type idxInfoRow struct {
				SeqNo int    `gorm:"column:seqno"`
				CID   int    `gorm:"column:cid"`
				Name  string `gorm:"column:name"`
			}
			var cols []idxInfoRow
			if err := db.Raw("PRAGMA index_info(" + quoteSQLiteString(idx.Name) + ")").Scan(&cols).Error; err != nil {
				log.Println("index_info failed for", idx.Name, ":", err)
				continue
			}
			if len(cols) == 1 && strings.EqualFold(strings.TrimSpace(cols[0].Name), "username") {
				if err := db.Exec("DROP INDEX IF EXISTS " + quoteSQLiteIdentifier(idx.Name)).Error; err != nil {
					log.Println("failed to drop legacy username unique index", idx.Name, ":", err)
				} else {
					log.Println("dropped legacy username unique index:", idx.Name)
				}
			}
		}
	case "postgres":
		// Typical default names from prior schema variants.
		db.Exec("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key")
		db.Exec("DROP INDEX IF EXISTS idx_users_username")
	}
}

func quoteSQLiteString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func quoteSQLiteIdentifier(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func validateFileEncryptionConfig() {
	raw := strings.TrimSpace(os.Getenv("FILE_ENCRYPTION_KEY"))
	if raw == "" {
		log.Fatal("FILE_ENCRYPTION_KEY is required (32-byte string or base64-encoded 32 bytes)")
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil {
		if len(b) == 32 {
			return
		}
	}
	if len(raw) == 32 {
		return
	}
	log.Fatal("FILE_ENCRYPTION_KEY must be exactly 32 bytes (plain) or base64 of 32 bytes")
}
