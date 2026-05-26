# Nolan Kim — Portfolio Site

Personal portfolio with an AI resume assistant powered by the Anthropic API.

## Project structure

```
nolan-portfolio/
├── index.html        # Main portfolio page
├── api/
│   └── chat.js       # Vercel Edge Function (API proxy)
├── vercel.json       # Vercel routing config
└── README.md
```

## Deploy to Vercel (5 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial portfolio"
git remote add origin https://github.com/YOUR_USERNAME/nolan-portfolio.git
git push -u origin main
```

### 2. Connect to Vercel
1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project** → import your repo
3. Framework preset: **Other**
4. Click **Deploy**

### 3. Add your Anthropic API key
1. In your Vercel project, go to **Settings → Environment Variables**
2. Add: `ANTHROPIC_API_KEY` = `sk-ant-...your key...`
3. Redeploy (Settings → Deployments → Redeploy)

### 4. (Optional) Add your resume PDF
Drop `Nolan_Kim_Resume.pdf` into the project root so the download button works.

## Local development

Since this is a static HTML file with a Vercel Edge Function, the easiest way to test locally:

```bash
npm i -g vercel
vercel dev
```

Then open `http://localhost:3000`.

## AI agent cost

The agent uses `claude-haiku-4-5` (the fastest, cheapest model) with `max_tokens: 400`.
At typical job-search usage (~50–100 recruiter sessions), expect costs well under $1.

## Customization

- **Colors / fonts**: Edit the `:root` CSS variables and font imports in `index.html`
- **Resume content**: Update the `RESUME` constant in the `<script>` block at the bottom of `index.html`
- **Suggested questions**: Edit the `.sug` buttons in the `#ask` section
- **Agent personality**: Edit the `SYSTEM` constant in the `<script>` block
