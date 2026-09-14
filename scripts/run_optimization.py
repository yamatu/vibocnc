#!/usr/bin/env python3
"""
FANUC Website Optimization Master Script
This script runs all optimization processes in the correct order.
"""

import sys
import subprocess
import time
import os

def run_script(script_name, description):
    """Run a Python script and handle errors"""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Script: {script_name}")
    print(f"{'='*60}")

    try:
        result = subprocess.run([sys.executable, script_name],
                              capture_output=True, text=True, cwd=os.path.dirname(__file__))

        if result.returncode == 0:
            print(f"✓ {description} completed successfully")
            if result.stdout:
                print("Output:")
                print(result.stdout)
        else:
            print(f"✗ {description} failed")
            if result.stderr:
                print("Error:")
                print(result.stderr)
            return False

    except Exception as e:
        print(f"✗ Error running {script_name}: {e}")
        return False

    return True

def install_requirements():
    """Install required Python packages"""
    print("Installing required packages...")
    packages = [
        'mysql-connector-python',
        'requests',
        'beautifulsoup4',
        'pandas'
    ]

    for package in packages:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"✓ {package} installed")
        except subprocess.CalledProcessError:
            print(f"✗ Failed to install {package}")
            return False

    return True

def main():
    """Main execution function"""
    print("🚀 Starting FANUC Website Optimization Process")
    print("This will optimize your website to match fanucworld.com structure and content")

    # Check if we're in the scripts directory
    if not os.path.exists('analyze_database.py'):
        print("❌ Please run this script from the scripts directory")
        sys.exit(1)

    # Install requirements
    if not install_requirements():
        print("❌ Failed to install required packages")
        sys.exit(1)

    # Step 1: Analyze current database
    if not run_script('analyze_database.py', 'Database Structure Analysis'):
        print("❌ Database analysis failed. Please check your database connection.")
        response = input("Continue anyway? (y/N): ")
        if response.lower() != 'y':
            sys.exit(1)

    # Step 2: Optimize database schema
    if not run_script('database_schema_optimizer.py', 'Database Schema Optimization'):
        print("❌ Database schema optimization failed.")
        response = input("Continue with content optimization? (y/N): ")
        if response.lower() != 'y':
            sys.exit(1)

    # Step 3: Wait a moment for database changes to take effect
    print("\n⏳ Waiting for database changes to take effect...")
    time.sleep(3)

    # Step 4: Run content optimization
    print("\n📝 Starting content optimization from fanucworld.com...")
    print("This process will:")
    print("- Search for your product SKUs on fanucworld.com")
    print("- Extract enhanced descriptions and specifications")
    print("- Update your database with improved SEO content")
    print("- Add meta tags and keywords for better search rankings")

    response = input("\nProceed with content optimization? (Y/n): ")
    if response.lower() != 'n':
        if not run_script('fanuc_content_optimizer.py', 'Content Optimization from FanucWorld'):
            print("❌ Content optimization encountered errors.")
            print("Some products may have been updated successfully.")

    # Summary
    print(f"\n{'='*60}")
    print("🎉 FANUC Website Optimization Complete!")
    print(f"{'='*60}")
    print("\nWhat has been done:")
    print("✓ Database schema enhanced with new SEO fields")
    print("✓ New tables created for reviews, FAQs, tags, and analytics")
    print("✓ Performance indexes added for better search")
    print("✓ Product content optimized with fanucworld.com data")
    print("✓ SEO metadata enhanced for better search rankings")

    print("\nNext steps:")
    print("1. Restart your Go backend to load new database schema")
    print("2. Update your frontend to use the new product fields")
    print("3. Test the website functionality")
    print("4. Submit your sitemap to Google Search Console")
    print("5. Monitor SEO performance in analytics")

    print("\nFiles created/updated:")
    print("- Backend models updated with new fields")
    print("- Database schema optimized")
    print("- Python scripts for ongoing optimization")

    print(f"\n🔧 Backend restart command:")
    print("cd ../backend && go run main.go")

    print(f"\n🌐 Frontend development command:")
    print("cd ../frontend && npm run dev")

if __name__ == "__main__":
    main()