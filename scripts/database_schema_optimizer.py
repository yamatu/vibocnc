import mysql.connector
from mysql.connector import Error
import os

# Database connection configuration
db_config = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': int(os.getenv('DB_PORT', '3306')),
    'database': os.getenv('DB_NAME', 'fanuc_sales'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', '')
}

class DatabaseSchemaOptimizer:
    def __init__(self):
        self.connection = None
        self.connect_to_database()

    def connect_to_database(self):
        """Connect to MySQL database"""
        try:
            self.connection = mysql.connector.connect(**db_config)
            if self.connection.is_connected():
                print("Connected to MySQL database for schema optimization")
        except Error as e:
            print(f"Error connecting to MySQL: {e}")

    def check_and_add_missing_fields(self):
        """Check and add missing fields to match fanucworld.com structure"""
        cursor = self.connection.cursor()

        # New fields to add based on fanucworld.com analysis
        new_fields = [
            # Enhanced product fields
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(50) DEFAULT '12 months'",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS condition_type ENUM('new', 'refurbished', 'used') DEFAULT 'new'",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS origin_country VARCHAR(50) DEFAULT 'China'",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100) DEFAULT 'FANUC'",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time VARCHAR(50) DEFAULT '3-7 days'",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS minimum_order_quantity INT DEFAULT 1",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_info TEXT",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS certifications TEXT",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS technical_specs JSON",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS compatibility_info TEXT",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS installation_guide TEXT",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS maintenance_tips TEXT",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS related_products JSON",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS video_urls JSON",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS datasheet_url VARCHAR(500)",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS manual_url VARCHAR(500)",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_score DECIMAL(3,2) DEFAULT 0.00",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_score DECIMAL(3,2) DEFAULT 0.00",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS last_optimized_at DATETIME",

            # Enhanced category fields
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon_class VARCHAR(100)",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_image VARCHAR(500)",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255)",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_description TEXT",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_keywords TEXT",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS product_count INT DEFAULT 0",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS featured_products JSON",
        ]

        try:
            print("Adding missing database fields...")
            for field_query in new_fields:
                try:
                    cursor.execute(field_query)
                    print(f"✓ {field_query.split('ADD COLUMN IF NOT EXISTS')[1].split()[0]} added/verified")
                except Error as e:
                    if "Duplicate column name" not in str(e):
                        print(f"✗ Error adding field: {e}")

            self.connection.commit()
            print("Schema updates completed successfully")

        except Error as e:
            print(f"Error updating schema: {e}")
            self.connection.rollback()
        finally:
            cursor.close()

    def create_seo_enhancement_tables(self):
        """Create additional tables for SEO enhancement"""
        cursor = self.connection.cursor()

        tables = [
            # SEO analytics table
            """
            CREATE TABLE IF NOT EXISTS seo_analytics (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                product_id BIGINT UNSIGNED NOT NULL,
                search_keyword VARCHAR(255) NOT NULL,
                search_count INT DEFAULT 0,
                conversion_rate DECIMAL(5,2) DEFAULT 0.00,
                last_searched_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_product_keyword (product_id, search_keyword),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
            """,

            # Product reviews table
            """
            CREATE TABLE IF NOT EXISTS product_reviews (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                product_id BIGINT UNSIGNED NOT NULL,
                customer_name VARCHAR(100) NOT NULL,
                customer_email VARCHAR(255),
                rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
                review_title VARCHAR(255),
                review_content TEXT,
                is_verified BOOLEAN DEFAULT FALSE,
                is_approved BOOLEAN DEFAULT FALSE,
                helpful_count INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_product_rating (product_id, rating),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
            """,

            # Product FAQs table
            """
            CREATE TABLE IF NOT EXISTS product_faqs (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                product_id BIGINT UNSIGNED NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                sort_order INT DEFAULT 0,
                view_count INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_product_active (product_id, is_active),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
            """,

            # Product cross-references table (for compatible/alternative parts)
            """
            CREATE TABLE IF NOT EXISTS product_cross_references (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                product_id BIGINT UNSIGNED NOT NULL,
                reference_product_id BIGINT UNSIGNED NOT NULL,
                reference_type ENUM('compatible', 'alternative', 'upgrade', 'related') NOT NULL,
                confidence_score DECIMAL(3,2) DEFAULT 1.00,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_product_ref (product_id, reference_type),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                FOREIGN KEY (reference_product_id) REFERENCES products(id) ON DELETE CASCADE,
                UNIQUE KEY unique_cross_ref (product_id, reference_product_id, reference_type)
            )
            """,

            # Enhanced product tags table
            """
            CREATE TABLE IF NOT EXISTS product_tags (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                slug VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                color VARCHAR(7) DEFAULT '#007bff',
                usage_count INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
            """,

            # Product-tag relationship table
            """
            CREATE TABLE IF NOT EXISTS product_tag_relations (
                product_id BIGINT UNSIGNED NOT NULL,
                tag_id BIGINT UNSIGNED NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (product_id, tag_id),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES product_tags(id) ON DELETE CASCADE
            )
            """
        ]

        try:
            print("Creating SEO enhancement tables...")
            for table_query in tables:
                cursor.execute(table_query)
                table_name = table_query.split("CREATE TABLE IF NOT EXISTS")[1].split()[0]
                print(f"✓ Table {table_name} created/verified")

            self.connection.commit()
            print("SEO enhancement tables created successfully")

        except Error as e:
            print(f"Error creating tables: {e}")
            self.connection.rollback()
        finally:
            cursor.close()

    def create_indexes_for_performance(self):
        """Create indexes for better SEO and search performance"""
        cursor = self.connection.cursor()

        indexes = [
            # Product search indexes
            "CREATE INDEX IF NOT EXISTS idx_products_search ON products(name, sku, brand, model)",
            "CREATE INDEX IF NOT EXISTS idx_products_seo ON products(meta_title, meta_keywords)",
            "CREATE INDEX IF NOT EXISTS idx_products_popularity ON products(view_count, popularity_score)",
            "CREATE INDEX IF NOT EXISTS idx_products_active_featured ON products(is_active, is_featured)",

            # Category indexes
            "CREATE INDEX IF NOT EXISTS idx_categories_seo ON categories(meta_title, meta_keywords)",
            "CREATE INDEX IF NOT EXISTS idx_categories_hierarchy ON categories(parent_id, sort_order)",

            # Product attributes indexes
            "CREATE INDEX IF NOT EXISTS idx_attributes_search ON product_attributes(attribute_name, attribute_value)",

            # Performance indexes
            "CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at)",
            "CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at)",
        ]

        try:
            print("Creating performance indexes...")
            for index_query in indexes:
                try:
                    cursor.execute(index_query)
                    index_name = index_query.split("CREATE INDEX IF NOT EXISTS")[1].split()[0]
                    print(f"✓ Index {index_name} created/verified")
                except Error as e:
                    if "Duplicate key name" not in str(e):
                        print(f"✗ Error creating index: {e}")

            self.connection.commit()
            print("Performance indexes created successfully")

        except Error as e:
            print(f"Error creating indexes: {e}")
        finally:
            cursor.close()

    def seed_default_data(self):
        """Seed default data for new fields and tables"""
        cursor = self.connection.cursor()

        try:
            print("Seeding default data...")

            # Update existing products with default values
            update_queries = [
                "UPDATE products SET warranty_period = '12 months' WHERE warranty_period IS NULL",
                "UPDATE products SET condition_type = 'new' WHERE condition_type IS NULL",
                "UPDATE products SET origin_country = 'China' WHERE origin_country IS NULL",
                "UPDATE products SET manufacturer = 'FANUC' WHERE manufacturer IS NULL",
                "UPDATE products SET lead_time = '3-7 days' WHERE lead_time IS NULL",
                "UPDATE products SET minimum_order_quantity = 1 WHERE minimum_order_quantity IS NULL",
            ]

            for query in update_queries:
                cursor.execute(query)

            # Seed product tags
            default_tags = [
                ('PCB Board', 'pcb-board', 'Printed Circuit Board components', '#28a745'),
                ('Servo Motor', 'servo-motor', 'High-precision servo motor systems', '#007bff'),
                ('Power Supply', 'power-supply', 'Reliable power supply units', '#ffc107'),
                ('I/O Module', 'io-module', 'Input/Output interface modules', '#6f42c1'),
                ('Control Unit', 'control-unit', 'Central control processing units', '#fd7e14'),
                ('Display Panel', 'display-panel', 'HMI display and control panels', '#20c997'),
                ('Memory Module', 'memory-module', 'Data storage and memory components', '#e83e8c'),
                ('Encoder', 'encoder', 'Position and speed feedback devices', '#6c757d'),
                ('Drive System', 'drive-system', 'Motor drive and control systems', '#17a2b8'),
                ('Interface Board', 'interface-board', 'Communication interface boards', '#dc3545'),
            ]

            tag_insert_query = """
            INSERT IGNORE INTO product_tags (name, slug, description, color)
            VALUES (%s, %s, %s, %s)
            """

            cursor.executemany(tag_insert_query, default_tags)

            # Update category product counts
            cursor.execute("""
                UPDATE categories c
                SET product_count = (
                    SELECT COUNT(*) FROM products p
                    WHERE p.category_id = c.id AND p.is_active = 1
                )
            """)

            self.connection.commit()
            print("Default data seeded successfully")

        except Error as e:
            print(f"Error seeding data: {e}")
            self.connection.rollback()
        finally:
            cursor.close()

    def close_connection(self):
        """Close database connection"""
        if self.connection and self.connection.is_connected():
            self.connection.close()

def main():
    """Main function to run schema optimization"""
    print("Starting database schema optimization for FANUC website...")

    optimizer = DatabaseSchemaOptimizer()

    try:
        # Step 1: Add missing fields to existing tables
        optimizer.check_and_add_missing_fields()

        # Step 2: Create new SEO enhancement tables
        optimizer.create_seo_enhancement_tables()

        # Step 3: Create performance indexes
        optimizer.create_indexes_for_performance()

        # Step 4: Seed default data
        optimizer.seed_default_data()

        print("\n✓ Database schema optimization completed successfully!")
        print("Your database is now optimized to match fanucworld.com structure")

    except Exception as e:
        print(f"Error in schema optimization: {e}")
    finally:
        optimizer.close_connection()

if __name__ == "__main__":
    main()
