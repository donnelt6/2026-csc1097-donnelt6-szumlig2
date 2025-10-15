# School of Computing &mdash; Year 4 Project Proposal Form

## SECTION A

|                     |                   |
|---------------------|-------------------|
|Project Title:       | Caddie            |
|Student 1 Name:      | Tadhg Donnelly            |
|Student 1 ID:        | 22480084            |
|Student 2 Name:      | Gavin Szumlicki            |
|Student 2 ID:        | 22511509            |
|Project Supervisor:  | Boualem Benatallah           |

## SECTION B

### Introduction

Modern organisations and individuals manage an ever-expanding mix of digital content. People need to navigate PDFs, wikis, onboarding guides, training manuals, meeting notes, and policies spread across multiple systems. Important details such as procedures, responsibilities, or deadlines are often buried inside long documents and remain hard to find at the moment they are needed. Current tools either focus on heavy enterprise knowledge bases that are difficult to use or academic note-taking and study apps that lack flexibility. This project proposes a web application, Caddie, designed specifically for onboarding and professional documentation workflows. It unifies document ingestion, AI-assisted search, and proactive reminders into a collaborative workspace that makes essential knowledge easier to access, understand, and act on.

### Outline

Caddie will alllow users to upload files, share links, and organise onboarding and documentation resources into shared workspaces called hubs. Each document passes through an ingestion pipeline that extracts text, chunks it for semantic search, and stores both original and processed representations. Users can create shared hubs to organise sources and collaborate, which will be especially useful in the case of large organisations. A conversational interface enables the user to query documentation in natural language and receive cited answers directly tied back to their sources. When the system detects deadlines, required tasks or action items in the content, it offers to create reminders that trigger in-app and via email notifications. It can also proactively generate step-by-step guides, FAQs and their answers or onboarding checklists from documentation, helping users move from raw information to actionable workflows.” The application is built with usability in mind, ensuring that uploading, managing and retrieving information feels simple and natural.

In terms of collaboration, shared hubs provide a structured way for managers, HR teams, or project leads to maintain professional knowledge bases. Owners can invite teammates, assign roles (viewer/editor), and track an activity history of uploads, reminders, and conversation. The ingestion pipeline supports PDFs, DOCX, Markdown, text files, and webpages, with a stretch goal of supporting YouTube or recorded training sessions. Each upload is normalised into structured text with metadata, embedded for semantic search, and always linked back to the original source to ensure transparency and trust in answers.

### Background

This idea emerged from our internship experiences, where we noticed that although our teams maintained centralized documentation, finding specific details quickly was still a major challenge. During our own onboarding in particular, we often found ourselves hunting through lengthy wiki pages or chat threads for information that should have been easy to surface - such as procedures, ways-of-working, or even just the right contact person. A tool like Caddie would have filled a clear gap by enabling conversational search across documentation with direct source citations, reducing both confusion and time lost. 

During his internship, Tadhg experimented with addressing this problem by building a simple chatbot connected to his team’s Confluence documentation. The prototype was created with Langflow and showed the potential of such an approach but also revealed its limitations, especially around retrieval accuracy and user-experience. This highlighted how much more beneficial a powerful and dedicated system could be. With recent advances in retrieval-augmented generation (RAG) and LLMs in general, it is  practical to deliver that kind of solution, blending personalised knowledge bases with an AI assistant that is genuinely useful for onboarding and ongoing team alignment.

### Achievements

The completed system will deliver a platform where individuals and teams-alike can consolidate and query onboarding and professional documentation. Core features include:

- Upload and ingestion of PDFs, DOCX, TXT, Markdown, webpages, and (stretch goal) YouTube training videos.. 
- Organisation of content inside shared hubs, where managers or team-leads can invite collaborators and maintain a trusted knowledge base.
- A conversational interface with a toggle to either limit answers to hub content or expand to the model’s broader knowledge, with citations included in every response.
- Automated detection of due dates, responsibilities, and action items within documentation, prompting users to create reminders that surface via email or in-app alerts.
- Proactively generate onboarding guides or checklists from documentation, providing structured support to users.

Primary users include HR departments, team-leads, and individuals beginning a new role or project. For example, HR could use Caddie to centralise training resources and policies for new hires, while a project team might rely on it to consolidate onboarding guides, technical manuals, and meeting notes. Likewise, someone starting in a new position or starting a new project can use it to quickly get up to speed. In every case, the goal is to accelerate learning and ensure no important detail slips through the cracks.

### Justification

Caddie will be useful in any context where people manage multiple sources of information but lack a single environment to bring them together. However, the tool is specifically designed for professional contexts where teams manage large volumes of onboarding and procedural documentation but lack a streamlined way to surface and act on key information. New employees in particular face a steep learning curve, often spending weeks hunting for details scattered across wikis, drives, and chat threads.

The market opportunity for solutions like Caddie is substantial and the need for a unified product is clear. The global knowledge management software market is projected to grow from about USD 30.1 billion in 2024 to USD 66.2 billion by 2032 [2], while the employee onboarding software market is forecast to expand from USD 3.5 billion in 2024 to over USD 8.2 billion by 2033 [1]. Together, these trends highlight growing demand for tools that not only store information but also make it actionable during onboarding and daily workflows. Current solutions often sit at extremes: heavy enterprise knowledge bases that are complex and under-utilised, or lightweight apps that lack the structure teams need. This gap demonstrates the need for a product like Caddie, one that combines ease of access, collaboration, and proactivity into a single, adaptable workspace.

Crucially, onboarding isn’t just a corporate function, it’s a universal transition process. Whether it’s a first-year student entering college, a volunteer joining a new organisation, or a new hire entering a company, each faces a similar challenge: fragmented information, unclear paths, and steep learning curves. Caddie is built to smooth these transitions across contexts by centralising knowledge and making it conversationally accessible.

### Programming language(s)

- **Javascript and Typescript** - for the Next.js frontend.
- **HTML/CSS** - User interface markup and styling.
- **Python** - Backend, FastAPI services and NLP pipelines.

### Programming tools / Tech stack

- Next.js with Tailwind CSS for the frontend.
- FastAPI for backend APIs, with Celery for handling workers that deal with ingestion and reminder jobs.
- Supabase Postgres, Supabase Auth, and Supabase Storage.
- OpenAI GPT-5 mini for conversational responses.
- Railway for hosting, GitHub Actions for CI/CD.

### Hardware

- Personal laptops/desktops for development.
- Lab computers.

### Learning Challenges

**AI and Retrieval**
- Designing retrieval-augmented prompts with consistent citations.
- Evaluation methods for hub-only and global answers.
- Managing hallucination risks in conversational responses.

**Data and Security**
- Ensuring data security, privacy, and access control.
- Guaranteeing data integrity when handling ingestion pipelines and large uploads.
- Labeling data accurately and extracting the correct metadata when dealing with webpages.
- Implementing transparent error handling and recovery strategies.

**Ingestion and Automation**
- Parsing long PDFs and webpages.
- Building resilient background jobs for reminders, parsing, and embeddings.
- Scheduling reminders across background jobs, email, and in-app alerts.
- Handling scale efficiently (large hubs, many concurrent uploads).

**Frontend**
- Designing a clear and effective UI.
- Implementing drag and drop file organisation.
- Streaming chat responses with real-time citation highlighting.

**Infrastructure**
- Implementing robust CI/CD pipelines and testing.
- Ensuring scalability and resilience of the application under different constraints.

### Breakdown of work

Both students will collaborate on the overall architecture design, documentation and in orchestration of comprehensive user testing. Alongside this, both students will contribute to frontend and backend, but each will take primary responsibility for different functional areas to ensure coverage and ownership.

#### Student 1 (Tadhg Donnelly) -- Backend, AI, and Infrastructure

**Backend**
- Database schema design (users, hubs, sources, chats, reminders).
- FastAPI services for ingestion, retrieval, and reminder scheduling.
- Pipelines for parsing, embedding, and email notifications.
- AI integration with formatting for cited responses.

**Frontend**
- Integration of backend APIs into the frontend.
- File upload flow (progress tracking, error states).
- Authentication flows, dashboards, and hub management screens.

#### Student 2 (Gavin Szumlicki) -- Frontend, UX, and Collaboration features

**Backend**
- Reminder scheduling logic (backend + frontend integration).
- API endpoints for user collaboration (roles, permissions).
- Deployment setup (Railway hosting, GitHub Actions CI/CD).
- Authentication and authorisation flows with Supabase.

**Frontend**
- Build the conversational interface
- Reminder prompts, notifications centre, and analytics views.
- Drag-and-drop file organisation and hub visualisation.


**Shared responsibilities**
- Architecture design, UI/UX design and project documentation.
- Comprehensive user testing and iterative feedback loops.

### Risk Register

| Description | Likelyhood | Severity | Mitigation |
|-------------|------------|----------|------------|
| Variability in document formats causes ingestion failures | Medium | High | Implement fallback plain-text extraction, add automated regression tests, and expose retry tooling for users. |
| Web scraping blocked by site policies | Medium | Medium | Respect robots.txt and provide manual upload fallback |
| Supabase outage impacts data access | Low | High | Enable automatic retries, maintain regular backups. |
| Users upload very large files exceeding limits | Medium | Medium | Set size caps, provide clear error messages, and suggest splitting documents. |
| Embedding generation fails due to API downtime | Medium | Medium | Queue requests, retry later, and surface placeholders until recovery. |


#### Student 1

> *Student 1 should complete this section.*

#### Student 2

> *Student 2 should complete this section.*

## Example

> Example: Here's how you can include images in markdown documents...

<!-- Basically, just use HTML! -->

<p align="center">
  <img src="./res/cat.png" width="300px">
</p>

### References

[1] Verified Market Reports, Employee Onboarding Software Market Size, Share & Forecast 2024–2033, Verified Market Research, 2025. Available: https://www.verifiedmarketreports.com/product/employee-onboarding-software-market/

[2] Market Research Future, Knowledge Management Software Market Research Report: By Component, Deployment Type, Organization Size, Industry Vertical — Forecast till 2032, Market Research Future, 2024. Available: https://www.marketresearchfuture.com/reports/knowledge-management-software-market-4193