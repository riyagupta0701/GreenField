package handlers

import (
	"github.com/gin-gonic/gin"
)

// Pattern A (fieldExtractor): gin.H response literal
func GetUser(c *gin.Context) {
	c.JSON(200, gin.H{
		"userId":      1,
		"email":       "alice@example.com",
		"displayName": "Alice",
	})
}

// Pattern C (fieldExtractor): response struct with json tags, NOT used as bind target
type UserResponse struct {
	UserId      int    `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName,omitempty"`
	Internal    string `json:"-"`
}

// Pattern A+B (usageTracker): ShouldBindJSON with declared struct
type CreateUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func CreateUser(c *gin.Context) {
	var req CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, gin.H{"created": true})
}

// Pattern C+D (usageTracker): c.Query and c.PostForm
func ListUsers(c *gin.Context) {
	page := c.Query("page")
	category := c.PostForm("category")
	_ = page
	_ = category
	c.JSON(200, gin.H{"ok": true})
}
