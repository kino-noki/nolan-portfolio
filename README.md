# Nolan Kim — Resume site + AI Nolan chatbot

A dark-technical resume site with an embedded AI chatbot ("AI Nolan") that answers
questions, triages support issues into Jira, and captures recruiter leads — all wired
through OpenAI and Zapier. **Your API key and webhook are kept server-side and are never
exposed to visitors' browsers.**

## Project structure

```
nolan-site/
├── api/
│   ├── chat.js        ← serverless function: calls OpenAI (holds the system prompt + key)
│   └── forward.js     ← serverless function: forwards payloads to your Zapier webhook
├── public/
│   └── index.html     ← the website + chatbot UI (no secrets inside)
├── vercel.json
└── package.json
```

## Why this is secure

In the old single-file version, the OpenAI key and Zapier webhook lived in the HTML, so
anyone could open DevTools and steal them. Here, the browser only ever talks to
`/api/chat` and `/api/forward` on your own domain. Those functions read the secrets from
Vercel **Environment Variables** at runtime — the secrets are never sent to the browser.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or use the Vercel CLI / drag-and-drop).
2. In Vercel, import the project. Framework preset: **Other**. Root directory: the
   `nolan-site` folder.
3. Go to **Project → Settings → Environment Variables** and add:

   | Name             | Value                                             |
   |------------------|---------------------------------------------------|
   | `OPENAI_API_KEY` | your OpenAI API key (starts with `sk-`)           |
   | `ZAPIER_WEBHOOK` | your Zapier Catch Hook URL                        |

4. Deploy. Visit your domain — the resume loads, and the chat box shows the name/email
   gate. Fill it in and the bot starts.

## Local testing

```
npm i -g vercel
vercel dev
```

`vercel dev` runs the serverless functions locally. Add the same two env vars to a
`.env.local` file (do NOT commit it):

```
OPENAI_API_KEY=sk-...
ZAPIER_WEBHOOK=https://hooks.zapier.com/hooks/catch/...
```

## Model

The chatbot uses `gpt-5.4`. To change it, edit the `model` field in `api/chat.js`.

## Editing the chatbot's knowledge/persona

The system prompt lives at the top of `api/chat.js` (kept server-side so visitors can't
read it). Edit it there and redeploy.
