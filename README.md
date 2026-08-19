# CodeVibes 🌊

> **AI Code Review for Developers Who Can't Afford CodeRabbit.**

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Status](https://img.shields.io/badge/status-beta-orange.svg) ![Stack](https://img.shields.io/badge/stack-React+Express-green.svg) ![AI](https://img.shields.io/badge/AI-DeepSeek-purple.svg)

CodeVibes is an intelligent code analysis tool that scans your GitHub repositories using AI to identify **Security Vulnerabilities**, **Bugs & Performance Issues**, and **Code Quality** improvements—giving you a quantifiable **Vibe Score** and actionable insights.

---

## 📸 See it in Action

### Dashboard & Pre-Analysis
| Dashboard | Pre-Analysis View |
|-----------|-------------------|
| ![Dashboard](public/screenshots/Dashboard.png) | ![Pre-Analysis](public/screenshots/Pre-Analysis.png) |

### Analysis in Progress
| Execution | Repo Selection |
|-----------|----------------|
| ![Execution](public/screenshots/execution.png) | ![Repo](public/screenshots/repo.png) |

### Post-Analysis Results
| Post-Analysis | Detailed Stats |
|---------------|----------------|
| ![Post-Analysis](public/screenshots/Post-analysis.png) | ![Stats](public/screenshots/Detailed%20analysis%20cost%20and%20stats.png) |

### Report & Insights
| Report Insights |
|-----------------|
| ![Report Insights](public/screenshots/Report-insight.png) |

---

## 🏗️ System Architecture

```mermaid
graph TB
    subgraph "Frontend (React + Vite)"
        UI[🖥️ AnalyzePage]
        Store[📦 Zustand Store]
        API_Client[🔗 API Client]
    end

    subgraph "Backend (Express + Node.js)"
        Server[⚙️ Express Server]
        Auth[🔐 Auth Controller]
        Analysis[🔍 Analysis Controller]
        History[📜 History Controller]
        
        subgraph "Services"
            GH_Service[📂 GitHub Service]
            AI_Service[🧠 DeepSeek Service]
        end
        
        DB[(💾 SQLite DB)]
    end

    subgraph "External APIs"
        GitHub[🐙 GitHub API]
        DeepSeek[🤖 DeepSeek AI]
    end

    UI --> Store
    Store --> API_Client
    API_Client -->|REST API| Server
    
    Server --> Auth
    Server --> Analysis
    Server --> History
    
    Analysis --> GH_Service
    Analysis --> AI_Service
    History --> DB
    Auth --> DB
    
    GH_Service -->|Fetch Files| GitHub
    AI_Service -->|Stream Analysis| DeepSeek
```

---

## 🔄 Analysis Workflow

Here's how CodeVibes processes your repository:

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant GitHub
    participant AI

    User->>Frontend: 1. Paste Repo URL
    Frontend->>Backend: 2. POST /api/analyze
    
    Backend->>GitHub: 3. Fetch file tree
    GitHub-->>Backend: File list
    
    Backend->>Backend: 4. Categorize files by priority
    
    loop For each Priority Level (P1→P2→P3)
        Backend->>GitHub: 5a. Fetch file contents
        GitHub-->>Backend: File content
        Backend->>AI: 5b. Stream analysis request
        AI-->>Backend: 5c. JSON issues (streamed)
        Backend-->>Frontend: 5d. SSE: Live updates
        Frontend-->>User: 5e. Display issues in real-time
    end
    
    Backend->>Backend: 6. Calculate Vibe Score
    Backend-->>Frontend: 7. Final report
    Frontend-->>User: 8. Show complete analysis
```

---

## 🎯 Priority-Based Scanning

CodeVibes uses a **three-tier priority system** to analyze files in order of importance:

```mermaid
graph LR
    subgraph "P1: Security (🛡️ First)"
        A1[".env files"]
        A2["auth.*, jwt.*"]
        A3["*password*, *secret*"]
        A4["config files"]
    end
    
    subgraph "P2: Core Logic (🧠 Second)"
        B1["controllers/"]
        B2["services/"]
        B3["models/"]
        B4["main.*, app.*"]
    end
    
    subgraph "P3: Quality (💎 Third)"
        C1["tests/"]
        C2["utils/"]
        C3["helpers/"]
        C4["Other files"]
    end
    
    A1 --> B1
    A2 --> B2
    A3 --> B3
    A4 --> B4
    
    B1 --> C1
    B2 --> C2
    B3 --> C3
    B4 --> C4
```

| Priority | Focus | Severity Levels | Example Detections |
|----------|-------|-----------------|-------------------|
+| **P1** | Security | CRITICAL, HIGH, MEDIUM, LOW | Hardcoded secrets, SQL injection, XSS, Auth bypass |
+| **P2** | Bugs & Performance | HIGH, MEDIUM, LOW | N+1 queries, Race conditions, Memory leaks |
+| **P3** | Code Quality | MEDIUM, LOW | DRY violations, Complexity, Maintainability |

---

## ✨ Key Features

### 🛡️ Security Analysis (P1)
- **Secret Detection**: AWS keys, GitHub tokens, Stripe keys, JWTs
- **Injection Attacks**: SQL, NoSQL, Command, Code injection
- **Auth Issues**: Missing JWT verification, IDOR, Session misconfig
- **XSS/CSRF**: Dangerous innerHTML, Missing CSRF tokens

### 🧠 Bug & Performance Detection (P2)
- **Logic Errors**: Null access, Off-by-one, Type coercion bugs
- **Performance**: N+1 queries, O(n²) algorithms, Memory leaks
- **Async Issues**: Unhandled promises, Race conditions
- **Data Integrity**: Missing transactions, Concurrent updates

### 💎 Code Quality Review (P3)
- **Readability**: Naming, Complexity analysis
- **DRY Violations**: Duplicated code patterns
- **Modern Practices**: Deprecated APIs, Better alternatives
- **Testability**: Hard-to-test code patterns

### 📊 Vibe Score
A calculated 0-100 score based on:
- Issue count and severity
- Files scanned vs issues found ratio
- Security issue weight (higher penalty)

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 18 + Vite | Fast, modern UI |
| | TailwindCSS | Utility-first styling |
| | Zustand | State management |
| | Lucide Icons | Consistent iconography |
| **Backend** | Node.js + Express | API server |
| | Better-SQLite3 | Local database |
| | tsx | TypeScript execution |
| **AI** | DeepSeek API | Code analysis |
| **Integration** | Octokit | GitHub API client |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** v18+
- **DeepSeek API Key** ([Get free key](https://platform.deepseek.com))
- **GitHub Token** (optional, for private repos)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/danish296/codevibes.git
cd codevibes

# 2. Install all dependencies
npm install
cd codevibes-backend && npm install && cd ..

# 3. Configure backend environment
cp codevibes-backend/.env.example codevibes-backend/.env
# Edit .env with your DeepSeek API key

# 4. Start both servers (use two terminals)
# Terminal 1: Backend
cd codevibes-backend && npm run dev

# Terminal 2: Frontend
npm run dev
```

### Environment Variables

Create `codevibes-backend/.env`:

```ini
# Required
PORT=3001
DEEPSEEK_API_KEY=sk-your-deepseek-key

# Optional
GITHUB_TOKEN=ghp-your-github-token
DB_PATH=./data/codevibes.db
DEEPSEEK_MODEL=deepseek-chat  # or deepseek-reasoner
ALLOWED_ORIGINS=http://localhost:8080
```

---

## 🔀 Development (codevibes-next)

This repository is a fork of [danish296/codevibes](https://github.com/danish296/codevibes), developed independently.

### Remotes

| Remote | Points to | Usage |
|--------|-----------|-------|
| `origin` | [kgrizz-git/codevibes-next](https://github.com/kgrizz-git/codevibes-next) | Push branches, open PRs here |
| `upstream` | [danish296/codevibes](https://github.com/danish296/codevibes) | Read-only reference — never push to it |

This clone has a local guard (`git remote set-url --push upstream no-pushing`) so any accidental `git push upstream` fails loudly. Re-apply it in fresh clones if you want the same safety net.

### Daily workflow

```bash
git checkout -b feature/my-change
# ... commit your work ...
git push origin feature/my-change   # then open a PR on GitHub (base: main of this fork)
```

`gh pr create` from a branch in this repo targets **this fork** by default — it will never open a PR against upstream.

### Syncing upstream changes

A scheduled workflow (`.github/workflows/upstream-check.yml`, weekly + manual trigger) watches upstream `main` and opens an issue here listing any new commits. When you see one:

```bash
git fetch upstream
git log --oneline HEAD..upstream/main   # review what's new
git merge upstream/main                 # or open a PR from a branch first
```

---

## 📂 Project Structure

```
codevibes/
├── src/                          # React Frontend
│   ├── components/
│   │   ├── layout/              # Header, Footer, Sidebar
│   │   └── ui/                  # UI primitives (Button, Card, etc.)
│   ├── pages/
│   │   ├── HomePage.tsx         # Landing page
│   │   ├── AnalyzePage.tsx      # Main analysis interface
│   │   └── SetupPage.tsx        # API key configuration
│   ├── lib/
│   │   └── api.ts               # Backend API client
│   └── store/
│       └── analysisStore.ts     # Zustand state
│
├── codevibes-backend/            # Express Backend
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── analysisController.ts
│   │   │   ├── historyController.ts
│   │   │   └── githubController.ts
│   │   ├── services/
│   │   │   ├── deepseekService.ts  # AI prompts & streaming
│   │   │   └── githubService.ts    # Repo fetching
│   │   ├── utils/
│   │   │   ├── database.ts         # SQLite setup
│   │   │   └── logger.ts           # Winston logging
│   │   └── server.ts               # Express app
│   └── data/                       # SQLite database storage
│
├── public/screenshots/             # App screenshots
└── README.md                       # You are here!
```

---

## 🔌 API Reference

### Analysis Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Start new analysis |
| `/api/analyze/stream` | GET | SSE stream for live updates |

### History Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/history` | GET | List past analyses |
| `/api/history` | POST | Save analysis result |
| `/api/history/:id` | DELETE | Delete analysis |

### GitHub Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/github/repos` | GET | List user's repos |
| `/api/github/validate` | POST | Check repo access |

---

## 🎨 Vibe Score Calculation

```typescript
function calculateVibeScore(issues: Issue[]): number {
  const weights = {
    CRITICAL: 25,
    HIGH: 15,
    MEDIUM: 5,
    LOW: 1
  };
  
  let penalty = issues.reduce((sum, issue) => 
    sum + weights[issue.severity], 0);
  
  return Math.max(0, 100 - penalty);
}
```

| Score Range | Label | Color |
|-------------|-------|-------|
| 90-100 | Excellent | 🟢 Green |
| 70-89 | Good | 🟡 Yellow |
| 50-69 | Needs Work | 🟠 Orange |
| 0-49 | Critical | 🔴 Red |

---

## 📝 Changelog

### [v1.0.0] - 2026-01-07

#### ⚡ Performance Optimizations
- **Parallel file fetching**: 5 concurrent requests instead of sequential (3-5x faster)
- **GitHub Tree API caching**: Reduced API calls by 80%
- **Lazy categorization**: Defer P2/P3 processing until needed (60% faster initial scan)

#### 🐛 Bug Fixes
- **Fixed history not saving**: Corrected SQL parameter mismatch (duplicate `cost` parameter)
- **Fixed timer issues**: 
  - Timer now restarts when continuing to next priority level
  - Timer now stops on analysis errors
  - Timer displays correctly when loading from history
- **Fixed DeepSeek response truncation**: Increased max_tokens from 8000 to prevent incomplete JSON responses

#### 🔧 Improvements
- **Enhanced error handling**: Better DeepSeek JSON parsing with truncation detection
- **Improved logging**: More detailed logs for debugging
- **Better OAuth setup**: Comprehensive setup guide with troubleshooting

#### 📚 Documentation
- Added comprehensive `.env.example` with all configuration options
- Improved error messages and user feedback
- Better TypeScript types and interfaces

### [v1.0.1] - 2026-01-10
📄 **New Changelog Page:** /changelog with full history.

🛡️ **Trust Indicators**: AES-256, Privacy, Open Source badges in Hero.

❓ **FAQ Section:** Added to Homepage.

🧭 **Navigation Updates**:
    - Header: API → CHANGELOG
    - Footer: Changelog (Resources), API Reference (Product), Jan 10 update badge.

### [v1.0.2] - 2026-01-12
🔒 **Security Hardening**: Expanded secret detection (AWS, Stripe, Google, etc.) & Critical severity for live keys.
⚡ **Stability**: Automated async error & memory leak detection.
📄 **Documentation**: Changelog updates & API ref alignments.
⬆️ **UX**: Added auto-scroll to top on navigation.

### [v1.0.3] - 2026-08-19
🔒 **Dependency patches**: Same-major npm bumps for Dependabot alerts (PostCSS, Express 4.22.2 transitives, react-router-dom 6.30.6, uuid 13.0.2, minimatch 9.0.9, plus overrides for nested lodash/js-yaml/brace-expansion/etc.).
⚠️ **Deferred**: React Router 7 and path-to-regexp 8 remain out of scope (breaking majors). Two Router advisories that only patch in 7.18 stay open.

### [v1.0.4] - 2026-08-19
🔒 **CSRF**: Browser POST/PUT/PATCH/DELETE must send `X-CSRF-Token` matching the `csrf_token` cookie. `GET /api/health` returns `csrfToken` for cross-origin SPAs.
🔒 **Auth cookie**: `auth_token` is AES-256-GCM encrypted; legacy JWTs still verify.
🔒 **API keys**: DeepSeek keys are encrypted in localStorage; old plaintext keys migrate on read.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [DeepSeek](https://deepseek.com) for powerful AI reasoning
- [Shadcn/ui](https://ui.shadcn.com) for beautiful UI components
- [Lucide](https://lucide.dev) for crisp icons

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/danish296/codevibes/issues)
- **Discussions**: [GitHub Discussions](https://github.com/danish296/codevibes/discussions)

---

**Crafted with 💜 by Danish Akhtar**

Star ⭐ this repo if you find it helpful!
