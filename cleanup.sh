#!/bin/bash

# Cleanup script for preparing repository for GitHub submission
# This script removes stale files, logs, and sensitive data

echo "🧹 Starting repository cleanup..."

# Remove old/backup files
echo "Removing old backup files..."
rm -f airtable_methods_old.js
rm -f course_status_old.js
rm -f image_old.js
rm -f llama_old.js
rm -f server_old.js
rm -f wati_old.js

# Remove system files
echo "Removing system files..."
rm -f .DS_Store
rm -f certificate.pdf

# Remove log files (they'll be recreated)
echo "Removing log files..."
rm -f logs/*.log

# Remove environment file (keep only template)
echo "Removing .env file (keep only .env.template)..."
rm -f .env

# Remove node_modules (will be reinstalled)
echo "Removing node_modules..."
rm -rf node_modules

echo "✅ Cleanup complete!"
echo ""
echo "Next steps:"
echo "1. Review changes: git status"
echo "2. Install dependencies: npm install"
echo "3. Copy environment template: cp .env.template .env"
echo "4. Configure your .env file with actual credentials"
echo "5. Test locally: npm run dev"
