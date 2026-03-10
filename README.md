# Socrates-EK WhatsApp Learning Platform

A WhatsApp-based learning platform that delivers personalized courses through conversational AI.

## Project Structure

```
├── src/                           # Source code
│   ├── config/                   # Configuration files
│   │   └── db.js                 # Database connection & setup
│   ├── services/                 # Business logic services
│   │   ├── certificate.js        # PDF certificate generation
│   │   ├── course_status.js      # Course approval & status management
│   │   ├── db_methods.js         # Database CRUD operations
│   │   ├── image.js              # Image processing & upload
│   │   ├── llama.js              # AWS Bedrock AI integration
│   │   └── twilio_whatsapp.js    # WhatsApp messaging via Twilio
│   ├── models/                   # MongoDB schemas
│   │   ├── AlfredWaitlist.js     # Waitlist management
│   │   ├── ConversationLog.js    # Chat history logging
│   │   ├── CourseContent.js      # Course content storage
│   │   ├── FlowTemplate.js       # Message templates
│   │   └── Student.js            # Student profiles & progress
│   ├── middleware/               # Express middleware
│   │   ├── errorHandler.js       # Global error handling
│   │   └── security.js           # Rate limiting & security
│   ├── flows/                    # WhatsApp conversation flows
│   │   └── courseFlow.js         # Main conversation logic
│   ├── utils/                    # Utility functions
│   │   ├── certificateStore.js   # Certificate storage management
│   │   ├── cloudinaryUpload.js   # Cloudinary file uploads
│   │   ├── logger.js             # Winston logging setup
│   │   ├── monitoring.js         # Health checks & monitoring
│   │   ├── s3Upload.js           # AWS S3 file uploads
│   │   ├── validation.js         # Input validation helpers
│   │   └── whatsappFormatter.js  # Message formatting
│   ├── public/                   # Static files
│   │   └── dashboard.html        # Admin dashboard
│   └── server.js                 # Express app entry point
├── config/                       # Deployment configurations
│   ├── aws/                      # AWS ECS deployment configs
│   │   ├── certificate-storage-policy.json
│   │   ├── scaling-policy.json
│   │   └── task-definition.json
│   └── docker/                   # Docker configurations
│       ├── Dockerfile            # Container build instructions
│       └── docker-compose.yml    # Multi-service setup
├── docs/                         # Documentation
│   └── AWS.md                    # AWS deployment guide
├── scripts/                      # Utility scripts
│   └── seed.js                   # Database seeding
├── .env.template                 # Environment variables template
├── .gitignore                    # Git ignore rules
├── LICENSE                       # MIT license
├── package.json                  # Dependencies and scripts
└── README.md                     # This file
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