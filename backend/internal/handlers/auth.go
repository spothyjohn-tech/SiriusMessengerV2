package handlers

import (
    "net/http"

    "github.com/gin-gonic/gin"

    "messenger/internal/auth"
    "messenger/internal/models"
)

type AuthHandler struct {
    auth *auth.AuthService
}

func NewAuthHandler(a *auth.AuthService) *AuthHandler {
    return &AuthHandler{auth: a}
}

type registerRequest struct {
    Username  string `json:"username" binding:"required"`
    Email     string `json:"email" binding:"required,email"`
    Password  string `json:"password" binding:"required,min=8"`
    PublicKey string `json:"publicKey" binding:"required"`
}

func (h *AuthHandler) Register(c *gin.Context) {
    var req registerRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    user, err := h.auth.Register(req.Username, req.Email, req.Password, req.PublicKey)
    if err != nil {
        c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
        return
    }

    c.JSON(http.StatusCreated, publicUser(user))
}

type loginRequest struct {
    Email    string `json:"email" binding:"required,email"`
    Password string `json:"password" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
    var req loginRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    accessToken, refreshToken, err := h.auth.Login(req.Email, req.Password)
    if err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
        return
    }

    u, err := h.auth.GetUserByEmail(req.Email)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
        return
    }

    c.JSON(http.StatusOK, gin.H{
        "accessToken":  accessToken,
        "refreshToken": refreshToken,
        "user":         publicUser(u),
    })
}

type refreshRequest struct {
    RefreshToken string `json:"refreshToken" binding:"required"`
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
    var req refreshRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    accessToken, err := h.auth.RefreshAccessToken(req.RefreshToken)
    if err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"accessToken": accessToken})
}

func publicUser(u *models.User) gin.H {
	return gin.H{
		"id":        u.ID,
		"username":  u.Username,
		"discriminator": u.Discriminator,
		"email":     u.Email,
		"avatar":    u.Avatar,
		"online":    u.Online,
		"lastSeen":  u.LastSeen,
		"publicKey": u.PublicKey,
	}
}

type patchMeRequest struct {
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
}

func (h *AuthHandler) UpdateMe(c *gin.Context) {
	var req patchMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Username == nil && req.Avatar == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nothing to update"})
		return
	}
	if req.Avatar != nil && len(*req.Avatar) > 3145728 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "avatar too large (max 3MB)"})
		return
	}

	userID := c.GetString("userId")
	u, err := h.auth.UpdateProfile(userID, req.Username, req.Avatar)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, publicUser(u))
}

func (h *AuthHandler) Logout(c *gin.Context) {
    var req struct {
        RefreshToken string `json:"refreshToken" binding:"required"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    if err := h.auth.Logout(req.RefreshToken); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AuthHandler) LogoutAll(c *gin.Context) {
    userID := c.GetString("userId")
    
    if err := h.auth.LogoutAll(userID); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"ok": true})
}

type changePasswordRequest struct {
    OldPassword string `json:"oldPassword" binding:"required"`
    NewPassword string `json:"newPassword" binding:"required,min=8"`
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
    var req changePasswordRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    userID := c.GetString("userId")
    if err := h.auth.ChangePassword(userID, req.OldPassword, req.NewPassword); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"ok": true})
}