import requests
import re
import time
import mysql.connector
from bs4 import BeautifulSoup
import json
from urllib.parse import urljoin, quote
import random
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

class FanucWorldScraper:
    def __init__(self):
        self.base_url = "https://fanucworld.com"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        })

    def search_part_number(self, part_number):
        """Search for a part number on fanucworld.com"""
        try:
            # Clean part number for search
            clean_part = part_number.replace('FANUC-', '').replace('-', '')

            # Try different search strategies
            search_urls = [
                f"{self.base_url}/search?q={quote(clean_part)}",
                f"{self.base_url}/part/{quote(clean_part)}",
                f"{self.base_url}/products/{quote(clean_part)}",
            ]

            for url in search_urls:
                print(f"Searching: {url}")
                response = self.session.get(url, timeout=10)

                if response.status_code == 200:
                    soup = BeautifulSoup(response.content, 'html.parser')

                    # Look for product information
                    product_info = self.extract_product_info(soup, clean_part)
                    if product_info:
                        return product_info

                time.sleep(random.uniform(1, 3))  # Rate limiting

            return None

        except Exception as e:
            print(f"Error searching for {part_number}: {e}")
            return None

    def extract_product_info(self, soup, part_number):
        """Extract product information from the page"""
        try:
            product_info = {
                'part_number': part_number,
                'title': '',
                'description': '',
                'specifications': [],
                'category': '',
                'brand': 'FANUC',
                'model': '',
                'features': [],
                'applications': '',
                'meta_keywords': [],
                'images': []
            }

            # Extract title
            title_selectors = ['h1', '.product-title', '.part-title', 'title']
            for selector in title_selectors:
                title_elem = soup.select_one(selector)
                if title_elem and part_number.lower() in title_elem.get_text().lower():
                    product_info['title'] = title_elem.get_text().strip()
                    break

            # Extract description
            desc_selectors = ['.product-description', '.part-description', '.description', 'meta[name="description"]']
            for selector in desc_selectors:
                if selector.startswith('meta'):
                    desc_elem = soup.select_one(selector)
                    if desc_elem:
                        product_info['description'] = desc_elem.get('content', '').strip()
                        break
                else:
                    desc_elem = soup.select_one(selector)
                    if desc_elem:
                        product_info['description'] = desc_elem.get_text().strip()
                        break

            # Extract specifications
            spec_sections = soup.find_all(['table', 'dl', '.specifications', '.specs'])
            for section in spec_sections:
                if section.name == 'table':
                    rows = section.find_all('tr')
                    for row in rows:
                        cells = row.find_all(['td', 'th'])
                        if len(cells) >= 2:
                            key = cells[0].get_text().strip()
                            value = cells[1].get_text().strip()
                            if key and value:
                                product_info['specifications'].append({'name': key, 'value': value})

                elif section.name == 'dl':
                    terms = section.find_all('dt')
                    definitions = section.find_all('dd')
                    for term, definition in zip(terms, definitions):
                        key = term.get_text().strip()
                        value = definition.get_text().strip()
                        if key and value:
                            product_info['specifications'].append({'name': key, 'value': value})

            # Extract category information
            breadcrumb = soup.select_one('.breadcrumb, .breadcrumbs, nav[aria-label="breadcrumb"]')
            if breadcrumb:
                links = breadcrumb.find_all('a')
                categories = [link.get_text().strip() for link in links if link.get_text().strip()]
                if categories:
                    product_info['category'] = categories[-1] if len(categories) > 1 else categories[0]

            # Extract keywords from meta tags and content
            keywords_meta = soup.select_one('meta[name="keywords"]')
            if keywords_meta:
                keywords = keywords_meta.get('content', '').split(',')
                product_info['meta_keywords'] = [kw.strip() for kw in keywords if kw.strip()]

            # Extract images
            img_selectors = ['.product-image img', '.part-image img', '.gallery img', 'img[alt*="{}"]'.format(part_number)]
            for selector in img_selectors:
                images = soup.select(selector)
                for img in images:
                    src = img.get('src') or img.get('data-src')
                    if src:
                        full_url = urljoin(self.base_url, src)
                        product_info['images'].append(full_url)

            # Enhance description with technical details
            if product_info['title'] and not product_info['description']:
                product_info['description'] = self.generate_enhanced_description(product_info)

            return product_info if product_info['title'] or product_info['description'] else None

        except Exception as e:
            print(f"Error extracting product info: {e}")
            return None

    def generate_enhanced_description(self, product_info):
        """Generate enhanced product description based on part number pattern"""
        part_number = product_info['part_number']

        # FANUC part number patterns and descriptions
        patterns = {
            'A06B': 'Servo Motor & Drive System',
            'A16B': 'Power Supply Unit',
            'A20B': 'Interface Board',
            'A02B': 'Main Circuit Board',
            'A03B': 'Digital I/O Board',
            'A05B': 'Pulse Generator Board',
            'A14B': 'Memory Board',
            'A61L': 'Display Monitor',
            'A66L': 'Touch Screen Panel',
            'A98L': 'Battery Pack',
            'A860': 'Absolute Encoder',
            'A911': 'Rotary Encoder'
        }

        base_descriptions = {
            'A06B': 'High-performance servo component engineered for precision motion control in industrial automation applications. Features advanced feedback systems and robust construction for reliable operation in demanding manufacturing environments.',
            'A16B': 'Reliable power supply module designed to provide stable electrical power for FANUC systems. Built with industrial-grade components ensuring consistent performance and long service life.',
            'A20B': 'Professional PCB module designed for signal processing and communication interfaces. Engineered with high-quality components for optimal performance in industrial control systems.',
            'A02B': 'Core processing board providing central control functions for FANUC systems. Features advanced microprocessor technology and comprehensive I/O capabilities.',
            'A03B': 'Digital input/output interface board enabling seamless communication between control systems and field devices. Designed for high-speed data processing and reliable signal transmission.',
            'A61L': 'Industrial display monitor designed for harsh manufacturing environments. Features high-resolution display technology and rugged construction for reliable HMI operations.',
            'A66L': 'Touch screen interface panel providing intuitive operator control. Built with industrial-grade touch technology and durable construction for continuous operation.',
            'A98L': 'Backup battery system ensuring data retention and system integrity during power interruptions. Features long-life battery technology and reliable charging circuits.',
            'A860': 'High-precision absolute encoder providing accurate position feedback for servo systems. Features advanced optical technology and robust mechanical construction.',
            'A911': 'Incremental rotary encoder designed for position and speed feedback applications. Engineered with precision optical components for accurate signal generation.'
        }

        # Find matching pattern
        for pattern, description in base_descriptions.items():
            if part_number.startswith(pattern):
                enhanced_desc = f"FANUC {part_number} {patterns.get(pattern, 'Industrial Component')}. {description}"

                # Add technical specifications if available
                if product_info['specifications']:
                    enhanced_desc += " Key specifications include: "
                    specs = [f"{spec['name']}: {spec['value']}" for spec in product_info['specifications'][:3]]
                    enhanced_desc += ", ".join(specs) + "."

                # Add application context
                enhanced_desc += " Suitable for various industrial automation applications requiring reliable performance and precision control."

                return enhanced_desc

        # Default description
        return f"FANUC {part_number} Industrial Automation Component. High-quality replacement part designed for FANUC systems. Engineered to meet original equipment specifications and performance standards."

class DatabaseUpdater:
    def __init__(self):
        self.connection = None
        self.connect_to_database()

    def connect_to_database(self):
        """Connect to MySQL database"""
        try:
            self.connection = mysql.connector.connect(**db_config)
            if self.connection.is_connected():
                print("Connected to MySQL database for updates")
        except Error as e:
            print(f"Error connecting to MySQL: {e}")

    def get_products_needing_optimization(self, limit=50):
        """Get products that need content optimization"""
        if not self.connection:
            return []

        cursor = self.connection.cursor(dictionary=True)
        try:
            # Get products with minimal descriptions or missing SEO data
            query = """
            SELECT id, sku, name, description, meta_title, meta_description, meta_keywords,
                   brand, model, part_number, category_id, short_description
            FROM products
            WHERE (description IS NULL OR LENGTH(description) < 100
                   OR meta_description IS NULL OR LENGTH(meta_description) < 50
                   OR meta_keywords IS NULL OR LENGTH(meta_keywords) < 20)
            AND is_active = 1
            ORDER BY created_at DESC
            LIMIT %s
            """
            cursor.execute(query, (limit,))
            return cursor.fetchall()
        except Error as e:
            print(f"Error fetching products: {e}")
            return []
        finally:
            cursor.close()

    def update_product_content(self, product_id, content_data):
        """Update product with enhanced content"""
        if not self.connection:
            return False

        cursor = self.connection.cursor()
        try:
            # Prepare update query
            update_fields = []
            values = []

            if content_data.get('description'):
                update_fields.append("description = %s")
                values.append(content_data['description'])

            if content_data.get('meta_title'):
                update_fields.append("meta_title = %s")
                values.append(content_data['meta_title'])

            if content_data.get('meta_description'):
                update_fields.append("meta_description = %s")
                values.append(content_data['meta_description'])

            if content_data.get('meta_keywords'):
                keywords = ', '.join(content_data['meta_keywords']) if isinstance(content_data['meta_keywords'], list) else content_data['meta_keywords']
                update_fields.append("meta_keywords = %s")
                values.append(keywords)

            if content_data.get('short_description'):
                update_fields.append("short_description = %s")
                values.append(content_data['short_description'])

            if not update_fields:
                return False

            values.append(product_id)
            update_query = f"""
            UPDATE products
            SET {', '.join(update_fields)}, updated_at = NOW()
            WHERE id = %s
            """

            cursor.execute(update_query, values)
            self.connection.commit()

            # Update product attributes if specifications are provided
            if content_data.get('specifications'):
                self.update_product_attributes(product_id, content_data['specifications'])

            print(f"Updated product {product_id} successfully")
            return True

        except Error as e:
            print(f"Error updating product {product_id}: {e}")
            self.connection.rollback()
            return False
        finally:
            cursor.close()

    def update_product_attributes(self, product_id, specifications):
        """Update product attributes/specifications"""
        if not self.connection or not specifications:
            return

        cursor = self.connection.cursor()
        try:
            # Clear existing attributes for this product
            cursor.execute("DELETE FROM product_attributes WHERE product_id = %s", (product_id,))

            # Insert new attributes
            for i, spec in enumerate(specifications[:10]):  # Limit to 10 specifications
                query = """
                INSERT INTO product_attributes (product_id, attribute_name, attribute_value, sort_order, created_at)
                VALUES (%s, %s, %s, %s, NOW())
                """
                cursor.execute(query, (product_id, spec['name'], spec['value'], i))

            self.connection.commit()

        except Error as e:
            print(f"Error updating attributes for product {product_id}: {e}")
            self.connection.rollback()
        finally:
            cursor.close()

    def close_connection(self):
        """Close database connection"""
        if self.connection and self.connection.is_connected():
            self.connection.close()

def main():
    """Main function to run the optimization process"""
    print("Starting FANUC product content optimization...")

    # Initialize components
    scraper = FanucWorldScraper()
    db_updater = DatabaseUpdater()

    try:
        # Get products needing optimization
        products = db_updater.get_products_needing_optimization(limit=20)  # Start with 20 products
        print(f"Found {len(products)} products needing optimization")

        for i, product in enumerate(products):
            print(f"\nProcessing product {i+1}/{len(products)}: {product['sku']}")

            # Search for content on fanucworld.com
            content_data = scraper.search_part_number(product['sku'])

            if content_data:
                # Enhance the content
                enhanced_content = {
                    'description': content_data.get('description', ''),
                    'meta_title': f"{product['name']} - {content_data.get('title', product['name'])} | VIBO CNC FANUC Parts",
                    'meta_description': content_data.get('description', '')[:155] + '...' if len(content_data.get('description', '')) > 155 else content_data.get('description', ''),
                    'meta_keywords': content_data.get('meta_keywords', []) + ['FANUC parts', 'CNC parts', 'industrial automation', product['sku']],
                    'short_description': content_data.get('description', '')[:200] + '...' if len(content_data.get('description', '')) > 200 else content_data.get('description', ''),
                    'specifications': content_data.get('specifications', [])
                }

                # Update database
                success = db_updater.update_product_content(product['id'], enhanced_content)
                if success:
                    print(f"✓ Successfully updated {product['sku']}")
                else:
                    print(f"✗ Failed to update {product['sku']}")
            else:
                print(f"✗ No content found for {product['sku']}")

            # Rate limiting
            time.sleep(random.uniform(2, 5))

    except KeyboardInterrupt:
        print("\nProcess interrupted by user")
    except Exception as e:
        print(f"Error in main process: {e}")
    finally:
        db_updater.close_connection()
        print("Optimization process completed")

if __name__ == "__main__":
    main()
