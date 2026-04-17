package middleware

import (
    "sync"
    "time"
    
    "github.com/gin-gonic/gin"
    "golang.org/x/time/rate"
)

type RateLimiter struct {
    limiters map[string]*rate.Limiter
    mu       sync.RWMutex
    rate     rate.Limit
    burst    int
}

func NewRateLimiter(r rate.Limit, b int) *RateLimiter {
    return &RateLimiter{
        limiters: make(map[string]*rate.Limiter),
        rate:     r,
        burst:    b,
    }
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    
    limiter, exists := rl.limiters[key]
    if !exists {
        limiter = rate.NewLimiter(rl.rate, rl.burst)
        rl.limiters[key] = limiter
    }
    
    return limiter
}

// Очистка старых лимитеров
func (rl *RateLimiter) cleanup() {
    ticker := time.NewTicker(10 * time.Minute)
    go func() {
        for range ticker.C {
            rl.mu.Lock()
            // Удаляем лимитеры старше 30 минут (можно улучшить)
            rl.limiters = make(map[string]*rate.Limiter)
            rl.mu.Unlock()
        }
    }()
}

func LoginRateLimit() gin.HandlerFunc {
    limiter := NewRateLimiter(rate.Limit(5.0/60.0), 5) // 5 попыток в минуту
    limiter.cleanup()
    
    return func(c *gin.Context) {
        key := c.ClientIP() // Можно также использовать email из запроса
        
        if !limiter.getLimiter(key).Allow() {
            c.JSON(429, gin.H{
                "error": "too many login attempts, please try again later",
            })
            c.Abort()
            return
        }
        
        c.Next()
    }
}

func RegisterRateLimit() gin.HandlerFunc {
    limiter := NewRateLimiter(rate.Limit(3.0/60.0), 3) // 3 регистрации в минуту
    limiter.cleanup()
    
    return func(c *gin.Context) {
        key := c.ClientIP()
        
        if !limiter.getLimiter(key).Allow() {
            c.JSON(429, gin.H{
                "error": "too many registration attempts, please try again later",
            })
            c.Abort()
            return
        }
        
        c.Next()
    }
}