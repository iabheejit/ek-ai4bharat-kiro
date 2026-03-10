# Socrates-EK WhatsApp Learning Platform

A WhatsApp-based learning platform that delivers personalized courses through conversational AI.

## Project Structure

```
├── src/                    # Source code
│   ├── config/            # Configuration files
│   │   └── db.js          # Database connection
│   ├── services/          # Business logic services
│   │   ├── certificate.js # Certificate generation
│   │   ├── course_status.js # Course status management
│   │   ├── db_methods.js  # Database operations
│   │   ├── image.js       # Image processing
│   │   ├── llama.js       # AI/LLM integration
│   │   └── twilio_whatsapp.js # WhatsApp messaging
│   ├── models/            # Database models
│   ├── middleware/        # Express middleware
│   ├── flows/             # WhatsApp conversation flows
│   ├── utils/             # Utility functions
│   ├── public/            # Static files
│   └── server.js          # Application entry point
├── config/                # Deployment configurations
│   ├── aws/              # AWS deployment configs
│   └── docker/           # Docker configurations
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.template .env
   # Edit .env with your configuration
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Start production server:**
   ```bash
   npm start
   ```

## Docker Deployment

```bash
cd config/docker
docker-compose up -d
```

## Environment Variables

See `.env.template` for required environment variables.

## API Documentation

The server exposes REST APIs for admin operations. See `docs/` for detailed API documentation.

## Contributing

1. Follow the established project structure
2. Update imports when moving files
3. Test changes locally before committing
4. Update documentation as needed