package main

import (
	"fanuc-backend/config"
	"fanuc-backend/controllers"
	"fanuc-backend/middleware"
	"fanuc-backend/routes"
	"fanuc-backend/services"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables based on environment
	env := os.Getenv("GO_ENV")
	if env == "" {
		env = "development"
	}

	var envFile string
	switch env {
	case "production":
		envFile = ".env.production"
	case "development":
		envFile = ".env"
	default:
		envFile = ".env"
	}

	if err := godotenv.Load(envFile); err != nil {
		log.Printf("Warning: %s file not found, trying .env", envFile)
		if err := godotenv.Load(); err != nil {
			log.Println("Warning: .env file not found, using system environment variables")
		}
	}

	log.Printf("Loaded environment from: %s", envFile)

	// Connect to database
	config.ConnectDatabase()
	// Connect to Redis (optional: rate limit + cache)
	config.ConnectRedis()
	// Resume bounded AI SEO jobs that were queued or interrupted by a container
	// restart. This is especially important for the automatic 30,000-product queue.
	controllers.ResumeAIAgentSEOJobs()
	// Resume durable SKU fallback-image work after a container restart.
	controllers.ResumeProductImageAutofillJobs()
	// Resume safe external-image cleanup and completed SKU archive imports.
	controllers.ResumeProductImageManagementJobs()

	// Set Gin mode
	ginMode := strings.TrimSpace(os.Getenv("GIN_MODE"))
	if ginMode == "" {
		if env == "production" {
			ginMode = "release"
		} else {
			ginMode = "debug"
		}
	}
	gin.SetMode(ginMode)

	// Create Gin router
	r := gin.New()
	// Allow larger multipart uploads (e.g. backup ZIP restore). Files are spooled to disk when exceeding this.
	r.MaxMultipartMemory = 256 << 20 // 256 MiB

	// Add middleware
	accessLog := strings.TrimSpace(os.Getenv("ACCESS_LOG"))
	if accessLog == "" {
		// Default: noisy logs are useful in dev, expensive in prod.
		if env == "production" {
			accessLog = "0"
		} else {
			accessLog = "1"
		}
	}
	if accessLog == "0" || strings.EqualFold(accessLog, "false") {
		r.Use(gin.LoggerWithWriter(io.Discard))
	} else {
		r.Use(gin.Logger())
	}
	r.Use(gin.Recovery())
	r.Use(middleware.CORSMiddleware())
	r.Use(middleware.AnalyticsMiddleware())

	// Setup routes
	routes.SetupRoutes(r)

	// Background jobs (best-effort)
	services.StartCloudflareAutoPurgeScheduler()
	services.StartAnalyticsCleanupScheduler()

	// Get host and port from environment
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	address := host + ":" + port

	// Start server
	log.Printf("Starting FANUC Backend API server on %s", address)
	log.Printf("Backend will be accessible at: http://%s", address)

	srv := &http.Server{
		Addr:              address,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		// Chunked archive uploads may arrive over a slower connection. The
		// request is still bounded by the per-chunk 8 MiB limit, while the
		// resumable protocol prevents a stalled client from holding a huge body.
		ReadTimeout:    15 * time.Minute,
		WriteTimeout:   15 * time.Minute,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MiB
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal("Failed to start server:", err)
	}
}
