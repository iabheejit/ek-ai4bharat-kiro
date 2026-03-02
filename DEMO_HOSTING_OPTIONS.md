# Demo Hosting Options for Socrates-EK

## 🎯 Best Options for Free Demo Hosting

### Option 1: Render.com (RECOMMENDED) ⭐
**Best for**: Full-stack app with MongoDB

**Free Tier**:
- ✅ Free web service (750 hours/month)
- ✅ Free PostgreSQL/MongoDB (90 days, then $7/month)
- ✅ Auto-deploy from GitHub
- ✅ HTTPS included
- ⚠️ Spins down after 15 min inactivity (cold start ~30s)

**Setup**:
```bash
# 1. Push to GitHub (already done!)
# 2. Go to render.com → New → Web Service
# 3. Connect GitHub repo: iabheejit/ek-ai4bharat-kiro
# 4. Configure:
#    - Name: socrates-ek-demo
#    - Environment: Docker
#    - Plan: Free
# 5. Add environment variables (from .env.template)
# 6. Deploy!
```

**Demo URL**: `https://socrates-ek-demo.onrender.com`

**Pros**:
- ✅ Easy setup (5 minutes)
- ✅ Auto-deploy on git push
- ✅ Free MongoDB included
- ✅ Good for demos

**Cons**:
- ⚠️ Cold starts (first request takes 30s)
- ⚠️ MongoDB free for 90 days only

---

### Option 2: Railway.app
**Best for**: Quick deployment with persistent storage

**Free Tier**:
- ✅ $5 free credit/month
- ✅ MongoDB included
- ✅ No cold starts
- ✅ Auto-deploy from GitHub

**Setup**:
```bash
# 1. Go to railway.app
# 2. New Project → Deploy from GitHub
# 3. Select: iabheejit/ek-ai4bharat-kiro
# 4. Add MongoDB service
# 5. Add environment variables
# 6. Deploy!
```

**Demo URL**: `https://socrates-ek-demo.up.railway.app`

**Pros**:
- ✅ No cold starts
- ✅ Better performance
- ✅ Easy MongoDB setup

**Cons**:
- ⚠️ $5/month credit runs out quickly
- ⚠️ Need credit card after trial

---

### Option 3: Fly.io
**Best for**: Global edge deployment

**Free Tier**:
- ✅ 3 shared VMs (256MB RAM each)
- ✅ 3GB persistent storage
- ✅ No cold starts
- ✅ Global CDN

**Setup**:
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Deploy
cd ek-aws
flyctl launch --name socrates-ek-demo
flyctl deploy
```

**Demo URL**: `https://socrates-ek-demo.fly.dev`

**Pros**:
- ✅ Best performance
- ✅ No cold starts
- ✅ Global deployment

**Cons**:
- ⚠️ Requires CLI setup
- ⚠️ More complex configuration

---

### Option 4: Vercel (Static Dashboard Only)
**Best for**: Hosting just the admin dashboard as a static demo

**Free Tier**:
- ✅ Unlimited static sites
- ✅ Global CDN
- ✅ Auto HTTPS
- ✅ No cold starts

**Setup**:
```bash
# 1. Create standalone dashboard
# 2. Deploy to Vercel
vercel --prod
```

**Demo URL**: `https://socrates-ek-demo.vercel.app`

**Pros**:
- ✅ Instant deployment
- ✅ Perfect for UI demos
- ✅ No backend needed

**Cons**:
- ⚠️ Dashboard only (no backend)
- ⚠️ Need to mock API calls

---

## 🎬 Recommended Approach: Multi-Tier Demo

### Tier 1: Static Dashboard Demo (Vercel)
**Purpose**: Show UI/UX without backend  
**Cost**: FREE forever  
**Setup Time**: 5 minutes

Create a standalone demo dashboard with mock data:

```html
<!-- demo-dashboard.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Socrates-EK Demo</title>
  <!-- Same styles as dashboard.html -->
</head>
<body>
  <!-- Same HTML as dashboard.html -->
  <script>
    // Mock API responses
    const API = '';
    const mockStudents = [
      { _id: '1', name: 'John Doe', phone: '919876543210', topic: 'JavaScript', progress: 'Pending', flowStep: 'awaiting_next', courseStatus: 'Content Created', nextDay: 2, nextModule: 1 },
      { _id: '2', name: 'Jane Smith', phone: '919876543211', topic: 'Python', progress: 'Completed', flowStep: 'course_complete', courseStatus: 'Content Created', nextDay: 3, nextModule: 3 },
      // ... more mock data
    ];
    
    // Override fetch to return mock data
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
      if (url.includes('/api/students')) {
        return { ok: true, json: async () => mockStudents };
      }
      // ... more mock endpoints
      return originalFetch(url, options);
    };
  </script>
</body>
</html>
```

**Deploy**:
```bash
# Create demo folder
mkdir demo
cp ek-aws/public/dashboard.html demo/index.html
# Add mock data script
# Deploy to Vercel
cd demo && vercel --prod
```

---

### Tier 2: Full Backend Demo (Render)
**Purpose**: Fully functional demo with real backend  
**Cost**: FREE (with cold starts)  
**Setup Time**: 15 minutes

**Steps**:
1. Create `render.yaml` in repo root
2. Push to GitHub
3. Connect to Render
4. Auto-deploy

---

## 📝 Step-by-Step: Deploy to Render (RECOMMENDED)

### 1. Create render.yaml

```yaml
# render.yaml
services:
  - type: web
    name: socrates-ek-demo
    env: docker
    plan: free
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: MONGODB_URI
        fromDatabase:
          name: socrates-db
          property: connectionString
      - key: TWILIO_ACCOUNT_SID
        sync: false
      - key: TWILIO_AUTH_TOKEN
        sync: false
      - key: TWILIO_WHATSAPP_NUMBER
        sync: false
      - key: AWS_REGION
        value: us-east-1
      - key: AWS_ACCESS_KEY_ID
        sync: false
      - key: AWS_SECRET_ACCESS_KEY
        sync: false
      - key: AWS_BEDROCK_MODEL_ID
        value: meta.llama3-70b-instruct-v1:0

databases:
  - name: socrates-db
    plan: free
    databaseName: socrates
    user: socrates
```

### 2. Add Demo Banner to Dashboard

```html
<!-- Add to dashboard.html -->
<div style="background:#f97316;color:#fff;padding:12px;text-align:center;font-weight:600;">
  🎬 DEMO MODE - This is a demonstration instance with limited functionality
</div>
```

### 3. Deploy

```bash
# Commit render.yaml
git add render.yaml
git commit -m "Add Render deployment config"
git push origin main

# Go to render.com
# 1. Sign up with GitHub
# 2. New → Blueprint
# 3. Connect repo: iabheejit/ek-ai4bharat-kiro
# 4. Render will auto-detect render.yaml
# 5. Add secret environment variables
# 6. Deploy!
```

### 4. Add Demo Link to README

```markdown
## 🎬 Live Demo

**Admin Dashboard**: https://socrates-ek-demo.onrender.com/dashboard

**Note**: Demo instance may take 30 seconds to wake up (free tier cold start).

**Demo Credentials**: No authentication required for demo.
```

---

## 🎨 Create Demo Screenshots

### 1. Take Screenshots

```bash
# Use browser dev tools or tools like:
# - Chrome DevTools (F12 → Device Toolbar)
# - Screely.com (add browser frame)
# - Carbon.now.sh (code screenshots)
```

### 2. Add to README

```markdown
## 📸 Screenshots

### Admin Dashboard
![Dashboard](https://raw.githubusercontent.com/iabheejit/ek-ai4bharat-kiro/main/docs/images/dashboard.png)

### Student Management
![Students](https://raw.githubusercontent.com/iabheejit/ek-ai4bharat-kiro/main/docs/images/students.png)

### Course Editor
![Courses](https://raw.githubusercontent.com/iabheejit/ek-ai4bharat-kiro/main/docs/images/courses.png)
```

---

## 🎥 Create Demo Video

### Option 1: Loom (Recommended)
1. Go to loom.com (free)
2. Record screen walkthrough (5 minutes)
3. Add to README:

```markdown
## 🎥 Video Demo

[![Watch Demo](https://img.youtube.com/vi/VIDEO_ID/0.jpg)](https://www.loom.com/share/VIDEO_ID)
```

### Option 2: YouTube
1. Record with OBS Studio (free)
2. Upload to YouTube
3. Add to README

---

## 💡 Best Practice: Hybrid Approach

### For GitHub README:
1. **Screenshots** - Show UI immediately
2. **Live Demo Link** - Render.com (with cold start warning)
3. **Video Demo** - Loom (2-3 minutes)
4. **Local Setup** - Docker compose for full experience

### Example README Section:

```markdown
## 🎬 Demo

### Live Demo
🔗 **[Try the Admin Dashboard](https://socrates-ek-demo.onrender.com/dashboard)**

⚠️ *Note: Demo instance may take 30 seconds to wake up (free tier cold start)*

### Video Walkthrough
📹 **[Watch 3-minute demo](https://www.loom.com/share/YOUR_VIDEO_ID)**

### Screenshots

<details>
<summary>📸 Click to view screenshots</summary>

#### Dashboard Overview
![Dashboard](docs/images/dashboard.png)

#### Student Management
![Students](docs/images/students.png)

#### Course Editor
![Courses](docs/images/courses.png)

</details>

### Try Locally
```bash
docker-compose up
# Visit http://localhost:3000/dashboard
```
```

---

## 📊 Comparison Table

| Platform | Cost | Cold Start | MongoDB | Setup Time | Best For |
|----------|------|------------|---------|------------|----------|
| **Render** | Free | Yes (30s) | Free 90d | 5 min | Full demo |
| **Railway** | $5/mo | No | Included | 5 min | Production-like |
| **Fly.io** | Free | No | Extra setup | 15 min | Performance |
| **Vercel** | Free | No | N/A | 2 min | UI demo only |

---

## ✅ Recommended Action Plan

1. **Immediate** (5 min):
   - Deploy static dashboard to Vercel
   - Add "Demo Mode" banner
   - Update README with link

2. **Short-term** (15 min):
   - Deploy full app to Render
   - Add render.yaml to repo
   - Configure environment variables

3. **Polish** (30 min):
   - Take screenshots
   - Record Loom video
   - Update README with media

4. **Optional**:
   - Create demo data seeder
   - Add "Reset Demo" button
   - Set up demo auto-reset cron

---

## 🚀 Quick Start: Deploy Now

```bash
# 1. Add render.yaml (see above)
git add render.yaml
git commit -m "Add Render deployment"
git push

# 2. Go to render.com
# 3. Sign up with GitHub
# 4. New → Blueprint
# 5. Select repo
# 6. Deploy!

# Your demo will be live at:
# https://socrates-ek-demo.onrender.com
```

---

**Recommendation**: Start with **Render.com** for a free, fully functional demo. It's the easiest and most complete solution for showcasing your project!
