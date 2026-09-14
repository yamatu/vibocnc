import mysql.connector
import json
import pandas as pd
import os
from mysql.connector import Error

# Database connection configuration
db_config = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': int(os.getenv('DB_PORT', '3306')),
    'database': os.getenv('DB_NAME', 'fanuc_sales'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', '')
}

def connect_to_database():
    """Connect to MySQL database"""
    try:
        connection = mysql.connector.connect(**db_config)
        if connection.is_connected():
            print("Successfully connected to MySQL database")
            return connection
    except Error as e:
        print(f"Error connecting to MySQL: {e}")
        return None

def analyze_database_structure():
    """Analyze current database structure"""
    connection = connect_to_database()
    if not connection:
        return

    cursor = connection.cursor()

    try:
        # Show all tables
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        print("Database Tables:")
        for table in tables:
            print(f"  - {table[0]}")

        # Analyze products table structure
        print("\n=== PRODUCTS Table Structure ===")
        cursor.execute("DESCRIBE products")
        columns = cursor.fetchall()
        for column in columns:
            print(f"  {column[0]}: {column[1]} - {column[2]} - {column[3]} - {column[4]} - {column[5]}")

        # Sample product data
        print("\n=== Sample Products ===")
        cursor.execute("SELECT id, sku, name, brand, model, part_number, description FROM products LIMIT 5")
        products = cursor.fetchall()
        for product in products:
            print(f"  SKU: {product[1]} | Name: {product[2]} | Brand: {product[3]} | Model: {product[4]}")
            if product[6]:  # description
                print(f"    Description: {product[6][:100]}...")

        # Count products
        cursor.execute("SELECT COUNT(*) FROM products")
        count = cursor.fetchone()[0]
        print(f"\nTotal products: {count}")

        # Check categories
        print("\n=== Categories ===")
        cursor.execute("SELECT id, name, slug FROM categories WHERE is_active = 1")
        categories = cursor.fetchall()
        for cat in categories:
            print(f"  {cat[0]}: {cat[1]} ({cat[2]})")

    except Error as e:
        print(f"Error analyzing database: {e}")
    finally:
        cursor.close()
        connection.close()

if __name__ == "__main__":
    analyze_database_structure()
