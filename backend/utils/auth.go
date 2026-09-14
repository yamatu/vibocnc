package utils

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const minimumJWTSecretBytes = 32

func getJWTSecret() ([]byte, error) {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len(secret) < minimumJWTSecretBytes {
		return nil, errors.New("JWT_SECRET must be at least 32 bytes")
	}
	return []byte(secret), nil
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

// CheckPasswordHash compares a password with its hash
func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// Claims represents JWT claims for admin users
type Claims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// CustomerClaims represents JWT claims for customers
type CustomerClaims struct {
	CustomerID uint   `json:"customer_id"`
	Email      string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateToken generates a JWT token for a user
func GenerateToken(userID uint, username, role string) (string, time.Time, error) {
	jwtSecret, err := getJWTSecret()
	if err != nil {
		return "", time.Time{}, err
	}

	expiresHours := 24 // default
	if hoursStr := os.Getenv("JWT_EXPIRES_HOURS"); hoursStr != "" {
		if hours, err := strconv.Atoi(hoursStr); err == nil {
			expiresHours = hours
		}
	}

	expirationTime := time.Now().Add(time.Duration(expiresHours) * time.Hour)

	claims := &Claims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "fanuc-backend",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)

	return tokenString, expirationTime, err
}

// ValidateToken validates a JWT token and returns claims
func ValidateToken(tokenString string) (*Claims, error) {
	jwtSecret, err := getJWTSecret()
	if err != nil {
		return nil, err
	}

	claims := &Claims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("fanuc-backend"))

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}

// CustomerJWTTTL returns the configured customer session lifetime.
func CustomerJWTTTL() time.Duration {
	hours := 168 // 7 days for customers
	if hoursStr := os.Getenv("CUSTOMER_JWT_EXPIRES_HOURS"); hoursStr != "" {
		if h, err := strconv.Atoi(hoursStr); err == nil && h > 0 {
			hours = h
		}
	}
	return time.Duration(hours) * time.Hour
}

// GenerateCustomerJWT generates a JWT token for a customer
func GenerateCustomerJWT(customerID uint, email string) (string, error) {
	jwtSecret, err := getJWTSecret()
	if err != nil {
		return "", err
	}

	expirationTime := time.Now().Add(CustomerJWTTTL())

	claims := &CustomerClaims{
		CustomerID: customerID,
		Email:      email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "fanuc-backend-customer",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)

	return tokenString, err
}

// ValidateCustomerToken validates a customer JWT token and returns claims
func ValidateCustomerToken(tokenString string) (*CustomerClaims, error) {
	jwtSecret, err := getJWTSecret()
	if err != nil {
		return nil, err
	}

	claims := &CustomerClaims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("fanuc-backend-customer"))

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}
