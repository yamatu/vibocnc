package services

import "fanuc-backend/models"

// ClassificationModel returns one deterministic model/part identifier for every
// classification entry point. Full manufacturer part numbers outrank broad
// family fields, while a known model family receives an additional score.
func ClassificationModel(product models.Product) string {
	return productClassificationModel(product)
}
