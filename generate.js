const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, ExternalHyperlink,
  LevelFormat, convertInchesToTwip, PageBreak
} = require("docx");
const fs = require("fs");

const PAGE_W = 11906; // A4
const MARGIN = 720; // 0.5in
const CONTENT_W = PAGE_W - MARGIN * 2;

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 100 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })],
  });
}
function pRuns(runs, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, ...opts, children: runs });
}
function bold(text) { return new TextRun({ text, bold: true }); }
function link(text, url) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text, style: "Hyperlink" })],
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 80 },
  });
}

function cell(children, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 1000, type: WidthType.DXA },
    shading: opts.header ? { fill: "2F5496", type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: Array.isArray(children) ? children : [children],
  });
}
function headerCell(text, width) {
  return cell([new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF" })] })], { width, header: true });
}
function bodyCell(text, width, opts = {}) {
  return cell([new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold })] })], { width });
}

function makeTable(headers, rows, widths) {
  const trHeader = new TableRow({
    children: headers.map((htext, i) => headerCell(htext, widths[i])),
    tableHeader: true,
  });
  const trRows = rows.map(
    (r) => new TableRow({ children: r.map((c, i) => bodyCell(String(c), widths[i])) })
  );
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [trHeader, ...trRows],
  });
}

// ---------- Cluster tables data ----------
const clusterA = [
  ["RAG for LLMs: A Survey (Gao et al., 2023)", "Taxonomy of Naive/Advanced/Modular RAG", "Doesn't specialize to a narrow domain (single course/company)"],
  ["A Survey on RAG Meeting LLMs (Fan et al., 2024)", "Formal taxonomy of RA-LLM techniques", "Leaves domain-specific retrieval/chunking tuning underexplored"],
  ["Agentic RAG: A Survey (Singh et al., 2025)", "Introduces agent loops (plan/retrieve/refine) over static RAG", "Reference architectures abstract; few small reproducible implementations"],
  ["Systematic Literature Review of RAG (Brown et al., 2025)", "128-study meta-review; calls for provenance/cost-aware pipelines", "Explicitly calls out lack of small-scale budget-aware implementations"],
];
const clusterB = [
  ["Automated Code Review in Practice (Cihan et al., 2025)", "73.8% of AI review comments resolved by devs; review time increased", "Notes faulty/unnecessary/irrelevant comments - a clear extension target"],
  ["Bugdar: AI-Augmented Secure Code Review (Naulty et al., 2025)", "RAG + fine-tunable LLM for project-specific security PR review", "Not evaluated for lightweight/local deployment"],
  ["CodeAgent: Autonomous Communicative Agents (Tang et al., 2024)", "Multi-agent (supervisor + specialists) beats single-pass review", "Complex orchestration; a simplified 2-agent version is doable"],
  ["SWR-Bench (Zeng et al., 2025)", "Multi-review aggregation boosts F1 by up to 43.67%", "Gives a ready-made, defensible evaluation method"],
];
const clusterC = [
  ["ConFit v2 (Yu et al., 2025)", "LLM hypothetical resumes + hard-negative mining, +13.8% recall", "Requires training a contrastive encoder - too heavy for solo scope"],
  ["JobMatchAI (Vyas et al., 2026)", "Embeddings + skill knowledge graph + explainable reranking", "Full KG construction heavy; simplified skills-graph is feasible"],
  ["Resume-Job Compatibility Scoring with GNNs + LLMs (Baghbanzadeh et al., 2025)", "GNN + LLM embeddings beat keyword ATS by 25%", "GNN training heavy; LLM-embedding + explanation half is reproducible"],
  ["Synapse (Erol et al., 2026)", "Two-stage dense recall + LLM rerank + LLM-guided resume optimization", "Two-stage retrieval+rerank pattern is well-documented and reproducible"],
];
const clusterD = [
  ["Automated Educational Question Generation at Bloom's Levels (Scaria et al., 2024)", "LLMs can hit different Bloom's cognitive levels with right prompting", "High variance across models/prompts - good target metric"],
  ["MCQ Generation Using LLMs: Methodology and Educator Insights (Biancini et al., 2024)", "Injecting source text into prompt reduces hallucination", "Only tested MCQs, not mixed question types"],
  ["LLM Agents for Exam Question Generation (Nikolovski et al., 2025)", "Compares VectorRAG, VectorGraphRAG, fine-tuned LLM agents vs course objectives", "Adaptable framework for a single course at small scale"],
  ["Automatic Item Generation in STEM using LLM Prompting (Chan et al., 2024)", "Chain-of-thought prompting improves multistep answer accuracy", "Confirms prompt-engineering alone (no fine-tuning) is enough"],
];
const clusterE = [
  ["Fake News Detection: CNNs vs LLMs vs NLP models (Roumeliotis et al., 2025)", "Fine-tuned GPT-4o hits 98.6% accuracy vs 58.6% for CNNs", "Shows fine-tuning an LLM API (not training from scratch) suffices"],
  ["Truth in the Age of AI: Fine-Tuning LLMs (Poudel et al., 2026)", "Compares RoBERTa vs GPT fine-tuning, reports training cost trade-offs", "Gives a directly reusable cost/accuracy comparison table"],
  ["Boosting Generalization of Fine-Tuning BERT (Qin et al., 2024)", "Plain fine-tuned BERT overfits, generalizes poorly to unseen fake news", "Well-documented weakness - good citable gap"],
];
const clusterF = [
  ["LLM-centric Pipeline for Invoice Extraction (Loukil et al., 2024)", "Fusing OCR (Tesseract/DocTR) with an LLM improves extraction accuracy", "Only tested on 2 datasets; layout diversity still open"],
  ["Info Extraction from Electricity Invoices with General-Purpose LLMs (Gomez et al., 2026)", "Prompt design (few-shot + cross-validation) dominates; 96-97% F1", "Directly usable recipe: good prompts + general LLM beat fine-tuning"],
  ["OCR or Not? Rethinking Document IE in the MLLM Era (Shen et al., 2026)", "Image-only input to a multimodal LLM can match OCR+LLM pipelines", "Means a separate OCR engine can be skipped entirely"],
];

const rankingRows = [
  ["1", "AI Exam/Question-Bank Generator (Bloom's-aware)", 7,9,7,8,9,9,9,"8.3","10-16","Beginner-Intermediate","85%"],
  ["2", "RAG Course-Material Q&A Assistant", 7,9,8,8,8,8,9,"8.1","14-20","Intermediate","85%"],
  ["3", "Explainable Resume-Job Matcher & Optimizer", 8,8,8,9,8,7,8,"8.0","20-28","Intermediate","80%"],
  ["4", "LLM Invoice/Receipt Extraction Tool", 6,9,6,7,7,9,9,"7.4","12-18","Beginner-Intermediate","88%"],
  ["5", "AI-Assisted Secure Code Review Bot", 8,7,8,8,8,6,8,"7.6","24-32","Intermediate","75%"],
  ["6", "GraphRAG Product-Discovery Assistant", 7,7,8,8,7,6,8,"7.3","22-30","Intermediate","78%"],
  ["7", "Retrieval-Grounded Fake-News Assistant", 7,7,7,8,7,6,8,"7.1","20-28","Intermediate","78%"],
  ["8", "Multi-hop Claim/Form Understanding (VLM+OCR)", 6,7,7,7,7,7,8,"7.0","18-24","Intermediate","80%"],
  ["9", "Multi-Agent Code-Reviewer Recommender", 6,6,7,6,7,5,7,"6.3","24-34","Advanced","70%"],
  ["10", "Job-Vacancy Search & Ranking with KG", 6,6,6,6,6,6,7,"6.1","22-30","Intermediate","75%"],
  ["11", "Plant Leaf Disease Detector (mobile)", 4,9,5,6,6,9,8,"6.7","8-14","Beginner","80%"],
  ["12", "Agentic Literature-Review Assistant", 6,6,7,6,7,5,8,"6.4","22-30","Intermediate-Advanced","78%"],
];

// ---------- Build sections ----------
const children = [];

children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: "B.Tech Final-Year Project Research Report", bold: true, size: 40 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: "Solo-Student, AI-Assisted, 1-4 Day Build Window", italics: true, size: 26 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: "Prepared for: Teja (Final-Year B.Tech)", size: 22 })],
  })
);

children.push(h2("How to Read This Report"));
children.push(p("Your hard constraint - a working prototype in 1-4 days, built mostly by one person with AI coding assistants - rules out anything that requires training a deep model from scratch, collecting a custom dataset, or renting GPU clusters. So every idea below is built around assembling existing pretrained models, embeddings, or LLM APIs into a well-engineered pipeline, not inventing new algorithms. That's exactly what real AI engineering work looks like today, and it's what a project committee wants to see: sound judgment in choosing and combining SOTA components, not a from-scratch ResNet."));
children.push(p("One honest caveat: 1-4 days gets you a working, demoable MVP with a clean UI and a defensible architecture - not a publishable research contribution. The distinctions below flag which ideas are a genuine weekend build versus which need closer to a full week if you want the report to feel substantial."));

// Section 1
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("1. Papers Found (Grounding Research)"));

function clusterSection(title, note, rows) {
  children.push(h2(title));
  children.push(makeTable(
    ["Paper", "Contribution", "Gap / Extension Room"],
    rows,
    [3400, 3400, 3266]
  ));
  children.push(p(note));
}

clusterSection("Cluster A - Retrieval-Augmented Generation (RAG)", "Reproducibility verdict: Easy. A single-domain RAG system (embeddings + vector store + LLM API) is one of the most reproducible advanced-AI patterns available - no training required.", clusterA);
clusterSection("Cluster B - LLM-Assisted Code Review", "Reproducibility verdict: Easy-Moderate. A GitHub-App-style PR bot using an LLM API + git diff parsing is buildable without any training; multi-agent orchestration (2-3 agents) is the advanced hook.", clusterB);
clusterSection("Cluster C - Resume-Job Matching", "Reproducibility verdict: Moderate. Skip GNN/contrastive training; keep embeddings (pretrained sentence-transformer or API) + LLM reranking + explanation - fully within a solo time budget.", clusterC);
clusterSection("Cluster D - Automatic Question / Exam Generation (directly relevant to your own course-material work)", "Reproducibility verdict: Very easy. Pure prompt-engineering + RAG over source material (notes/PDFs) + Bloom's-taxonomy tagging logic. No training, no GPU.", clusterD);
clusterSection("Cluster E - Fake News / Misinformation Detection", "Reproducibility verdict: Moderate. Skip full fine-tuning; use a pretrained fact-checking-style classifier or zero/few-shot LLM classification + a retrieval step against real news sources (turns it into a mini fact-checking RAG system).", clusterE);
clusterSection("Cluster F - Invoice / Document Understanding", "Reproducibility verdict: Very easy. A vision-capable LLM API call + a structured-output schema is close to the whole pipeline.", clusterF);

children.push(h2("Cluster G - Plant Disease Detection (flagged, not recommended as top pick)"));
children.push(p("Extremely well-covered by transfer learning on PlantVillage/Kaggle datasets with off-the-shelf CNNs (VGG19, MobileNet, EfficientNet). Reproducibility is trivially easy (fine-tune a pretrained CNN on PlantVillage in a Colab notebook in hours) - but it is one of the most overdone final-year project topics in India, so novelty and demo wow-factor score low. Included for completeness; not advanced further."));

// Section 2
children.push(h1("2. Literature Review - Cross-Cluster Patterns"));
children.push(pRuns([bold("Common methods across all clusters: "), new TextRun("pretrained transformer embeddings, LLM-API prompting (often with few-shot or chain-of-thought), and retrieval-augmented pipelines that ground generation in real documents rather than model memory.")]));
children.push(pRuns([bold("Common weaknesses called out by the papers themselves:")]));
[
  "RAG evaluation is inconsistent and rarely reports cost/latency alongside accuracy (Cluster A).",
  "LLM code review tools generate too many low-value comments, hurting adoption despite good resolution rates (Cluster B).",
  "Heavy models (GNNs, contrastive encoders) outperform simple embeddings only marginally once LLM reranking is added (Cluster C).",
  "Question-generation quality varies a lot across models/prompts, and automated metrics don't track human judgment well (Cluster D).",
  "Fine-tuned classifiers overfit and don't generalize to new misinformation (Cluster E) - retrieval-grounded fact-checking is the emerging fix.",
  "OCR is being displaced by vision-capable LLMs, but structured accuracy is still lower on images (67%) and audio (24%) than text (83%) (Cluster F).",
].forEach((t) => children.push(bullet(t)));
children.push(pRuns([bold("Turning gaps into project directions: "), new TextRun("in every cluster, the paper-identified weakness is solvable at solo-project scale by adding one deliberate, well-scoped improvement - a cost/latency dashboard, a comment-filtering step, an explanation layer, a Bloom's-taxonomy validator, a retrieval-grounded verification step, or a structured-output schema - rather than by chasing the full research pipeline.")]));

// Section 3
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("3. Project Ranking"));
children.push(p("Scored 1-10 per criterion. AI-generated % and Dev time reflect a realistic solo build, not an idealized one."));
children.push(makeTable(
  ["#", "Idea", "Nov", "Feas", "Depth", "Demo", "Report", "Ease", "AI-Cmp", "Overall", "Hours", "Difficulty", "AI %"],
  rankingRows,
  [350, 2500, 500, 500, 550, 550, 600, 500, 600, 700, 700, 1300, 550]
));
children.push(p("Ranking logic applied per priority rules: ideas #1, #2, and #4 finish highest partly because they're faster to implement and demo. #3 earns its top-3 slot on demo value and real-world relevance despite slightly longer dev time. Plant disease detection scores high on ease but low on novelty/demo value - it's excluded from the top 3 for exactly that reason, even though it's the single easiest build on this list."));

// Section 4
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("4. Full Proposals - All 12 Ideas"));

function proposal(title, sections) {
  children.push(h2(title));
  sections.forEach(([label, text, isArch]) => {
    children.push(pRuns([bold(label + ": ")]));
    if (isArch) {
      text.split("\n").forEach((line) => children.push(p(line, { font: "Consolas" })));
    } else if (Array.isArray(text)) {
      text.forEach((t) => children.push(bullet(t)));
    } else {
      children.push(p(text));
    }
  });
}

proposal("Proposal 1: AI-Powered Question-Bank Generator with Bloom's-Taxonomy Validation", [
  ["Abstract", "An AI-assisted authoring tool that ingests course notes or a syllabus (PDF/text), generates exam questions (MCQ, short-answer, descriptive) across specified Bloom's-taxonomy cognitive levels, tags each question with its level and difficulty, and lets an instructor edit/approve items in a clean web UI before exporting a formatted question bank."],
  ["Objective", "Reduce the manual effort of building a well-distributed, cognitively-balanced question bank, while keeping a human editor in the loop for quality control."],
  ["Methodology", [
    "Parse uploaded course material into clean text chunks.",
    "Prompt an LLM (with the source text injected, not relied on from memory) to generate candidate questions per topic and target Bloom's level.",
    "Run each candidate through a second validator LLM pass that checks answerability, grammaticality, and level alignment - a lightweight version of the multi-agent evaluation pattern from the literature review.",
    "Present results in a review UI with accept/edit/reject controls; export to DOCX/PDF question bank.",
  ]],
  ["Architecture", "[Upload PDF/notes] -> [Chunker] -> [Generator LLM (per-topic, per-Bloom's-level prompts)]\n   -> [Validator LLM (answerability + level check)] -> [Review UI] -> [Export: DOCX/PDF]\nModular split: small FastAPI/Node backend for chunking + LLM calls, React frontend for review, local JSON/SQLite for session storage.", true],
  ["Required Datasets", "None to train - use your own (or sample) course notes as input material. Optionally validate against a public dataset like RACE or SciQ for a benchmark comparison section in the report."],
  ["Evaluation Plan", "Human-rated coverage, grammaticality, answerability, and Bloom's-level accuracy on a sample of 30-50 generated questions; compare zero-shot vs. few-shot vs. chain-of-thought prompting."],
  ["Risks & Mitigations", [
    "Hallucinated facts -> mitigate by injecting source text into every prompt, never generating from model memory alone.",
    "Level-tagging drift -> mitigate with the validator pass and a small human-reviewed sample.",
  ]],
  ["Semester Timeline", [
    "Day 1: chunking + generation pipeline + basic prompts",
    "Day 2: validator pass + review UI",
    "Day 3: export pipeline + evaluation on sample questions",
    "Day 4 (buffer): polish UI, write report, prep demo",
    "Remaining weeks: expand evaluation set, write full report/documentation, rehearse viva",
  ]],
  ["Why It Fits 1-4 Days", "Every component is a prompt-engineering + UI-integration task against an LLM API - no training, no custom dataset, no GPU. It's also the one idea directly grounded in work you already do."],
]);

proposal("Proposal 2: RAG-Based Course-Material Q&A Assistant", [
  ["Abstract", "A retrieval-augmented Q&A system that lets a student or instructor ask natural-language questions over a specific course's material (lecture notes, textbook PDFs) and get answers grounded in and cited to the source text, rather than the LLM's general knowledge."],
  ["Objective", "Reduce hallucination in AI-assisted studying by grounding every answer in retrieved, citable source passages - directly addressing the domain-specific knowledge gap flagged in RAG surveys."],
  ["Methodology", [
    "Ingest and chunk course PDFs; embed chunks with a pretrained sentence-embedding model.",
    "Store embeddings in a lightweight vector store (FAISS/Chroma).",
    "On a query, retrieve top-k chunks, then prompt an LLM to answer using only retrieved content, citing the source page/section.",
    "Add a lightweight agentic refinement step: if retrieved context looks insufficient, re-query with a reformulated question.",
  ]],
  ["Architecture", "[PDF upload] -> [Chunker] -> [Embedding model] -> [Vector store]\n   ^                                                    v\n[User query] -> [Retriever] -> [top-k chunks] -> [LLM answer + citations] -> [Chat UI]\n   (if low-confidence) -> [query reformulation] -> retry retrieval", true],
  ["Required Datasets", "Your own course PDFs (e.g., the quantum computing materials you already maintain) - no external dataset needed. Optionally benchmark against a public QA dataset for a generalizability section."],
  ["Evaluation Plan", "Retrieval metrics (Recall@k, MRR) on a small set of question-answer pairs you write yourself; answer faithfulness judged manually against source text."],
  ["Risks & Mitigations", [
    "Poor chunking hurts retrieval quality -> mitigate with overlap-aware chunking and testing 2-3 chunk sizes.",
    "Latency/cost from repeated LLM calls -> cap the agentic retry loop at 1 reformulation.",
  ]],
  ["Semester Timeline", [
    "Day 1: ingestion + chunking + embedding + vector store",
    "Day 2: retrieval + baseline Q&A with citations",
    "Day 3: agentic reformulation step + chat UI",
    "Day 4 (buffer): evaluation pass, polish, demo prep",
  ]],
  ["Why It Fits 1-4 Days", "Standard RAG is one of the most well-documented, off-the-shelf-component patterns in current AI engineering - embedding models, vector stores, and LLM APIs are all plug-and-play."],
]);

proposal("Proposal 3: Explainable Resume-Job Matching & Optimization Platform", [
  ["Abstract", "A web platform where a candidate uploads a resume and a job description; the system computes a semantic match score using pretrained embeddings, explains why (which skills matched/missed) via an LLM reasoning layer, and suggests specific resume edits to improve alignment."],
  ["Objective", "Move beyond keyword-based ATS filtering toward transparent, semantically-aware matching that a candidate can actually act on."],
  ["Methodology", [
    "Parse resume and job description into structured sections (skills, experience, education) via LLM extraction.",
    "Embed both with a pretrained sentence-transformer; compute cosine similarity for an overall match score.",
    "Use an LLM reasoning pass to generate a structured explanation: matched skills, missing skills, and 3-5 concrete resume-edit suggestions.",
    "Present results in a dashboard: match score, skill-gap chart, editable resume suggestions.",
  ]],
  ["Architecture", "[Resume PDF] -> [LLM parser] -> [Structured resume JSON]\n[Job desc text] -> [LLM parser] -> [Structured JD JSON]\n   v                                    v\n[Embed both] -> [Cosine similarity score]\n   v\n[LLM explanation layer] -> [Skill-gap report + edit suggestions] -> [Dashboard UI]", true],
  ["Required Datasets", "Publicly available sample resumes/job postings (e.g., Kaggle resume datasets) for demo and light evaluation - no training data required since no model is trained."],
  ["Evaluation Plan", "Compare match scores and rankings against a small human-annotated set (rank 10-15 resume/JD pairs yourself as ground truth); report correlation with human ranking."],
  ["Risks & Mitigations", [
    "Embedding-only scores can miss nuance (seniority, tone) -> mitigate with the LLM explanation layer as a second check, not just the raw score.",
    "Parsing errors on messy resume formats -> mitigate by supporting common formats and failing gracefully with a manual-entry fallback.",
  ]],
  ["Semester Timeline", [
    "Day 1: resume/JD parsing + structured extraction",
    "Day 2: embedding + similarity scoring",
    "Day 3: LLM explanation layer + dashboard UI",
    "Day 4 (buffer): evaluation against your annotated set, polish, demo prep",
  ]],
  ["Why It Fits 1-4 Days", "No training step anywhere in the pipeline - parsing, embedding, and explanation are all API/pretrained-model calls; the UI is the main manual-build component, and it's the kind of React work you're already comfortable with."],
]);

proposal("Proposal 4: Intelligent Invoice/Receipt Extraction & Expense Automation Tool", [
  ["Abstract", "A tool that ingests scanned/PDF invoices or receipts and outputs structured, schema-validated data (vendor, line items, totals, tax) using a vision-capable LLM, then feeds it into a simple expense dashboard - no separate OCR engine required."],
  ["Objective", "Automate small-business expense entry, grounded in the finding that prompt quality (not OCR pipeline complexity) is the dominant factor in extraction accuracy."],
  ["Methodology", [
    "Accept an invoice image/PDF; send directly to a vision-capable LLM with a fixed JSON schema.",
    "Use few-shot examples in the prompt (shown to boost F1 by 19+ points over zero-shot).",
    "Validate the returned JSON against the schema; flag low-confidence fields for manual correction.",
    "Store validated records; render a simple expense dashboard (totals by vendor/category/month).",
  ]],
  ["Architecture", "[Upload invoice image/PDF] -> [Vision LLM + few-shot schema prompt] -> [JSON validator]\n   -> [Low-confidence flag / manual fix UI] -> [Expense DB] -> [Dashboard]", true],
  ["Required Datasets", "Public invoice datasets (e.g., SROIE, FATURA) for evaluation; your own sample receipts for the demo."],
  ["Evaluation Plan", "Field-level extraction accuracy (exact match) and schema-compliance rate on a held-out sample of 20-30 invoices; compare zero-shot vs. few-shot prompting."],
  ["Risks & Mitigations", [
    "Unusual layouts reduce accuracy -> mitigate with a manual-correction fallback UI, never silent failure.",
    "Sensitive financial data -> keep all processing local/demo-only, don't claim production-grade security.",
  ]],
  ["Semester Timeline", ["Day 1: schema + prompt pipeline", "Day 2: validation + correction UI", "Day 3: dashboard", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "A single vision-LLM API call plus a validation layer is the pipeline - no OCR engine, no training."],
]);

proposal("Proposal 5: AI-Assisted Secure Code Review Bot for GitHub Pull Requests", [
  ["Abstract", "A GitHub-integrated bot that reviews pull requests for security and quality issues using an LLM grounded in the specific repo's context (via RAG over the codebase), then posts filtered, high-value comments - directly targeting the too-many-low-value-comments problem documented in the literature."],
  ["Objective", "Improve on plain LLM PR review by filtering for signal, since prior field studies found automated review increased PR closure time due to noisy comments despite a 73.8% resolution rate."],
  ["Methodology", [
    "On PR open, fetch the diff and retrieve relevant surrounding code context (simple RAG over the repo).",
    "Prompt an LLM to flag security/quality issues with a confidence score.",
    "Filter: only post comments above a confidence threshold, running 2 passes and keeping only agreeing issues.",
    "Post comments via the GitHub API on the PR.",
  ]],
  ["Architecture", "[GitHub webhook: PR opened] -> [Diff + context retriever] -> [LLM review (2 passes)]\n   -> [Confidence filter / agreement check] -> [GitHub API: post comments]", true],
  ["Required Datasets", "Your own or a sample open-source repo with real PRs for demo/testing."],
  ["Evaluation Plan", "Precision of flagged issues against a manually reviewed sample of PRs (real vs. noise); compare filtered vs. unfiltered comment volume."],
  ["Risks & Mitigations", [
    "False positives erode trust -> mitigate with the confidence-filter/agreement step.",
    "GitHub API/webhook setup adds integration overhead -> budget a half-day specifically for this.",
  ]],
  ["Semester Timeline", ["Day 1: diff parsing + context retrieval", "Day 2: LLM review + filtering logic", "Day 3: GitHub API integration + demo repo", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "No training; the two-pass filtering step is the only extra complexity beyond a basic RAG-style prompt pipeline, and it directly answers a documented gap in the papers."],
]);

proposal("Proposal 6: GraphRAG Product-Discovery Assistant for E-Commerce", [
  ["Abstract", "A conversational product-search assistant for an e-commerce catalog that combines semantic retrieval with a lightweight product-relationship graph (category, style, price tier) so it can answer comparative and exploratory queries that plain keyword or vector search handle poorly."],
  ["Objective", "Apply the GraphRAG pattern at small scale to a real catalog rather than a generic enterprise knowledge base."],
  ["Methodology", [
    "Represent the product catalog as a small graph (product -> category, style, price tier, related items).",
    "Embed product descriptions for semantic retrieval.",
    "On a query, combine graph traversal (for relational queries) with vector retrieval (for descriptive queries), then let an LLM compose the answer.",
    "Present as a chat panel over the catalog UI.",
  ]],
  ["Architecture", "[Product catalog] -> [Graph builder (category/style/price edges)] + [Embedding index]\n[User query] -> [Query router: graph vs. vector vs. both] -> [LLM composer] -> [Chat UI]", true],
  ["Required Datasets", "Your own catalog data (pairs naturally with your fashion e-commerce project) or a public product dataset for demo."],
  ["Evaluation Plan", "Manually curate 15-20 comparative/exploratory queries; check whether retrieved products are actually relevant, comparing graph+vector vs. vector-only retrieval."],
  ["Risks & Mitigations", [
    "Small catalogs give a thin graph -> mitigate by keeping graph relations simple (3-4 edge types).",
    "Query routing logic can misclassify -> keep a use-both fallback path.",
  ]],
  ["Semester Timeline", ["Day 1: graph construction + embedding index", "Day 2: query router + retrieval", "Day 3: chat UI integration", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "The graph is intentionally small and hand-built, not learned - well within scope, and it has a natural connection to a catalog you already maintain."],
]);

proposal("Proposal 7: Retrieval-Grounded Fake-News / Fact-Check Assistant", [
  ["Abstract", "Rather than a plain fine-tuned classifier (shown to overfit and generalize poorly to new misinformation), this tool retrieves related real news articles for a claim and has an LLM reason over the retrieved evidence to produce a verdict with citations - a mini fact-checking RAG system."],
  ["Objective", "Build a more generalizable, explainable alternative to static classifiers, addressing the specific weakness the literature calls out."],
  ["Methodology", [
    "Take a claim/headline as input.",
    "Retrieve related articles via a news search API or a pre-indexed news corpus.",
    "Prompt an LLM to compare the claim against retrieved evidence and output a verdict (supported/contradicted/unclear) with cited sources.",
    "Display verdict, confidence, and evidence snippets in a simple UI.",
  ]],
  ["Architecture", "[Claim input] -> [News retrieval (API/search)] -> [Evidence chunks]\n   -> [LLM verdict + citation reasoning] -> [Verdict + evidence UI]", true],
  ["Required Datasets", "A small hand-labeled test set of true/false claims (LIAR or FakeNewsNet subsets) for evaluation; live retrieval for the demo."],
  ["Evaluation Plan", "Accuracy against the labeled test set; compare retrieval-grounded verdicts vs. a zero-shot LLM classification baseline (expect better performance on novel claims)."],
  ["Risks & Mitigations", [
    "Retrieval may surface biased or low-quality sources -> mitigate by restricting retrieval to a curated set of reputable outlets.",
    "Claims with no matching evidence -> the system should say insufficient evidence, not force a verdict.",
  ]],
  ["Semester Timeline", ["Day 1: retrieval pipeline", "Day 2: LLM reasoning/verdict prompt", "Day 3: UI + evidence display", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "No fine-tuning required; it's a retrieval + reasoning pipeline, and the grounded-vs-static-classifier framing gives a genuinely defensible research angle for the report."],
]);

proposal("Proposal 8: Multi-Hop Claim/Form Understanding Assistant (Vision-LLM + Structured Output)", [
  ["Abstract", "A document-understanding tool for messy real-world forms (insurance claims, applications) that classifies document type and extracts fields using a compact vision-language model, following a hybrid pipeline pattern shown effective at production scale."],
  ["Objective", "Handle document type diversity (not just one invoice template) by combining lightweight classification with schema-driven extraction."],
  ["Methodology", [
    "Classify the uploaded document's type (claim, ID, invoice, etc.) via a simple LLM classification prompt.",
    "Route to a type-specific extraction schema/prompt.",
    "Extract fields via a vision-capable LLM; validate against the schema.",
    "Present extracted data with a document-type confidence score and low-confidence-field flags.",
  ]],
  ["Architecture", "[Upload document image] -> [LLM document-type classifier] -> [Type-specific schema]\n   -> [Vision LLM extraction] -> [Schema validator] -> [Review UI]", true],
  ["Required Datasets", "A small set of sample forms across 3-4 types (mix of public samples and self-created mock forms) for demo/evaluation."],
  ["Evaluation Plan", "Document-type classification accuracy and field-level extraction accuracy per type on a held-out sample."],
  ["Risks & Mitigations", [
    "Handwritten or degraded documents reduce accuracy -> scope the demo to typed/printed documents, note handwriting as future work.",
    "Schema mismatches across document types -> keep the schema set small (3-4 types).",
  ]],
  ["Semester Timeline", ["Day 1: classifier + schema design", "Day 2: extraction pipeline", "Day 3: review UI", "Day 4 (buffer): evaluation on multiple document types, polish"]],
  ["Why It Fits 1-4 Days", "Same core pattern as Proposal 4 (vision-LLM + schema), with an added classification step - still no training required."],
]);

proposal("Proposal 9: Multi-Agent Code-Reviewer Recommender", [
  ["Abstract", "A tool that recommends the best human reviewer for a given pull request by combining semantic similarity between the PR and reviewers' past review history with a small multi-agent reasoning step that weighs expertise area, workload, and past collaboration."],
  ["Objective", "Reduce the time maintainers spend manually assigning reviewers on active repos."],
  ["Methodology", [
    "Embed PR diffs/descriptions and each candidate reviewer's history of past reviewed PRs.",
    "Compute semantic similarity to shortlist candidates.",
    "Use two lightweight LLM agents - one scoring expertise fit, one estimating workload/availability - and combine their scores.",
    "Output a ranked reviewer list with a one-line justification per candidate.",
  ]],
  ["Architecture", "[New PR] -> [Embed PR] -> [Similarity vs. reviewer history] -> [Shortlist]\n   -> [Expertise agent] + [Workload agent] -> [Score combiner] -> [Ranked list + justification]", true],
  ["Required Datasets", "A public open-source repo's PR/reviewer history (via GitHub API) for demo and evaluation."],
  ["Evaluation Plan", "Compare recommended reviewer vs. the actual historical reviewer on a held-out set of past PRs (top-1/top-3 accuracy)."],
  ["Risks & Mitigations", [
    "Multi-agent orchestration adds complexity/debugging time -> keep it to exactly 2 agents, not an open-ended pipeline.",
    "Sparse reviewer history hurts similarity matching -> fall back to team-wide expertise tags if history is too thin.",
  ]],
  ["Semester Timeline", ["Day 1: data pull + embeddings", "Day 2: two-agent scoring", "Day 3: ranking UI", "Day 4 (buffer): evaluation, polish - this is the most orchestration-heavy idea on the list, budget the full 4 days"]],
  ["Why It Fits (With Caveats)", "Feasible in 4 days only if you cap the agent count at 2 and use a public repo's existing history rather than collecting new data - flagged Advanced difficulty for this reason."],
]);

proposal("Proposal 10: AI-Powered Job-Vacancy Search & Ranking Tool with Knowledge Graph", [
  ["Abstract", "A job-search tool that goes beyond keyword filters by combining sentence embeddings, extracted skill entities, and a small skills knowledge graph to rank vacancies by true relevance to a candidate profile."],
  ["Objective", "Improve vacancy ranking quality for niche/technical roles where keyword search misses synonymous skills."],
  ["Methodology", [
    "Extract named entities/skills from job postings via LLM prompting.",
    "Build a lightweight skills graph (skill -> related skills) from the extracted entities.",
    "Embed postings and candidate profile; rank by combined embedding similarity + graph-expanded skill overlap.",
    "Display ranked results with matched/related-skill explanations.",
  ]],
  ["Architecture", "[Job postings] -> [LLM entity/skill extractor] -> [Skills graph]\n[Candidate profile] -> [Embed] -> [Similarity + graph-expanded overlap] -> [Ranked results UI]", true],
  ["Required Datasets", "Public job-posting datasets (e.g., Kaggle job listings) for demo/evaluation."],
  ["Evaluation Plan", "Compare system ranking against a small human-annotated relevance ranking (Rank-Biased Overlap or similar)."],
  ["Risks & Mitigations", ["Skills graph built purely from postings may be noisy -> keep it shallow (direct co-occurrence only, no multi-hop inference) for reliability within the time budget."]],
  ["Semester Timeline", ["Day 1: entity extraction + graph construction", "Day 2: ranking pipeline", "Day 3: UI", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "No training; graph is hand-built from LLM-extracted entities, not learned."],
]);

proposal("Proposal 11: Plant Leaf Disease Detector (Mobile-First Transfer Learning App)", [
  ["Abstract", "A mobile-friendly web app where a farmer/student photographs a plant leaf and gets an instant disease classification and treatment suggestion, using a pretrained CNN (e.g., MobileNet or EfficientNet) fine-tuned briefly on the public PlantVillage dataset."],
  ["Objective", "Demonstrate a complete, deployable transfer-learning pipeline - the easiest build on this list, included for completeness even though it's ranked below the top picks on novelty and demo differentiation."],
  ["Methodology", [
    "Fine-tune a pretrained CNN (MobileNetV2 or similar) on PlantVillage in a notebook - a few epochs, not from scratch.",
    "Wrap the trained model behind a simple inference API.",
    "Build a mobile-friendly upload/camera UI.",
    "Add an LLM-generated treatment suggestion based on the predicted disease label.",
  ]],
  ["Architecture", "[Leaf photo upload] -> [Pretrained CNN inference API] -> [Disease label + confidence]\n   -> [LLM treatment suggestion] -> [Mobile UI]", true],
  ["Required Datasets", "PlantVillage (public, Kaggle) - no custom data collection needed."],
  ["Evaluation Plan", "Standard train/val/test accuracy on PlantVillage, following the transfer-learning benchmarks cited in Cluster G of Section 1."],
  ["Risks & Mitigations", ["Real-world photos (varied lighting/background) perform worse than clean PlantVillage images -> be upfront about this limitation in the report rather than overclaiming real-field accuracy."]],
  ["Semester Timeline", ["Day 1: fine-tune model in a notebook", "Day 2: inference API", "Day 3: mobile UI + treatment suggestions", "Day 4 (buffer): polish"]],
  ["Why It Fits 1-4 Days", "The easiest build here - a few-epoch fine-tune of a small pretrained CNN takes hours, not days, on free-tier GPU (Colab). Note: ranked lower overall because this exact project is extremely common in Indian B.Tech programs - expect an evaluator to have seen several versions of it already."],
]);

proposal("Proposal 12: Agentic Literature-Review Assistant", [
  ["Abstract", "A research tool (fittingly, similar in spirit to how this very report was assembled) that takes a topic, searches academic APIs for relevant papers, extracts structured summaries (problem, method, gap), and synthesizes a literature-review draft with a comparison table."],
  ["Objective", "Automate the most time-consuming part of early research: finding and summarizing relevant papers into a structured, comparable format."],
  ["Methodology", [
    "Take a research topic/query; search an academic API (e.g., Semantic Scholar) for candidate papers.",
    "For each paper, prompt an LLM to extract a structured summary (problem, method, dataset, contribution, gap) from the abstract.",
    "Cluster papers by theme (embedding-based clustering) and generate a comparison table.",
    "Synthesize a short literature-review draft citing the structured summaries.",
  ]],
  ["Architecture", "[Research topic] -> [Academic search API] -> [Candidate papers]\n   -> [LLM structured-summary extractor] -> [Embedding-based clustering]\n   -> [Comparison table + review draft generator] -> [Export UI]", true],
  ["Required Datasets", "None - live academic API calls (Semantic Scholar/similar) for both demo and evaluation."],
  ["Evaluation Plan", "Manually check summary accuracy against 10-15 paper abstracts; check whether thematic clustering groups genuinely related papers together."],
  ["Risks & Mitigations", [
    "Academic APIs have rate limits -> cache results during development/demo.",
    "LLM summarization can misrepresent a paper's contribution -> always link back to the source abstract so a reader can verify.",
  ]],
  ["Semester Timeline", ["Day 1: search + extraction pipeline", "Day 2: clustering + comparison table", "Day 3: review-draft generator + export UI", "Day 4 (buffer): evaluation, polish"]],
  ["Why It Fits 1-4 Days", "No training; the main complexity is prompt design for reliable structured extraction, which is well within scope. Good meta pitch value in a viva - you can literally demo it on your own topic search."],
]);

// Section 5
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("5. Viva Preparation"));

function vivaSection(title, qas, arch, pitch) {
  children.push(h2(title));
  children.push(pRuns([bold("Likely Questions & Model Answers:")]));
  qas.forEach((qa, i) => {
    children.push(pRuns([bold(`${i + 1}. ${qa[0]} `), new TextRun({ text: qa[1] })]));
  });
  children.push(pRuns([bold("Architecture in one sentence: "), new TextRun({ text: arch, italics: true })]));
  children.push(pRuns([bold("One-minute pitch: "), new TextRun({ text: pitch, italics: true })]));
}

vivaSection(
  "Proposal 1 - AI Question-Bank Generator",
  [
    ["Why not just use ChatGPT directly instead of building a system?", "Because raw ChatGPT prompting has no source grounding, no Bloom's-level control, and no review workflow; my system enforces all three, reducing hallucination and giving instructors control."],
    ["How do you prevent hallucinated questions?", "By always injecting the actual source text into the generation prompt rather than relying on the model's own knowledge."],
    ["What is Bloom's taxonomy and why does it matter here?", "A hierarchy of cognitive levels (remember, understand, apply, analyze, evaluate, create); a good exam should sample across levels, not just recall."],
    ["How do you validate that a generated question is actually at the level you claim?", "A second LLM pass re-classifies the question's level independently; disagreement flags it for human review."],
    ["What happens if the LLM API is unavailable?", "The system degrades gracefully - caches previously generated questions and shows a clear error state, not a crash."],
    ["How would you evaluate quality without a large human panel?", "Small-sample expert rating (10-15 questions per topic) plus automated proxy metrics such as answerability and grammaticality."],
    ["What's the biggest technical risk in this project?", "Prompt sensitivity - quality varies noticeably with prompt wording, so I standardize prompts and test a few variants before finalizing."],
    ["How is this different from existing tools like Quizlet AI?", "Mine ties generation directly to the instructor's own source material and Bloom's-level targeting, with a human-in-the-loop review step, rather than generic flashcard generation."],
    ["Could this scale to multiple courses?", "Yes - the pipeline is course-agnostic; only the uploaded source material changes."],
    ["What would you improve with more time?", "A feedback loop where instructor edits are used to auto-tune future prompts per topic."],
  ],
  "Course material goes in, gets chunked and fed to a generator LLM per topic and cognitive level, a second LLM validates each question, and a human reviews and exports the final set.",
  "Instructors spend hours writing exam questions that cover the right mix of recall, application, and analysis. My system takes their own course notes, generates candidate questions tagged by Bloom's level, has a second AI pass check each one for accuracy and level-correctness, and gives the instructor a simple review screen to approve or edit before exporting a ready-to-use question bank - cutting authoring time while keeping a human in control of quality."
);

vivaSection(
  "Proposal 2 - RAG Course-Material Q&A Assistant",
  [
    ["What is RAG and why not just fine-tune a model on the course material?", "RAG retrieves relevant passages at query time and grounds the answer in them, avoiding the cost, staleness, and hallucination risk of fine-tuning a model on a small, static dataset."],
    ["How do you choose chunk size?", "Empirically - I test a couple of sizes/overlaps and pick the one with the best retrieval recall on my test question set."],
    ["What embedding model did you use and why?", "A pretrained sentence-embedding model chosen for a good balance of speed and semantic accuracy on short-to-medium text."],
    ["How do you know the answer is actually grounded and not hallucinated?", "The prompt instructs the LLM to answer only from retrieved context and say not found if the answer isn't present; I manually check faithfulness on a sample."],
    ["What's the agentic refinement step doing exactly?", "If retrieved chunks look insufficient (low similarity scores), the system reformulates the query once and retries retrieval before answering."],
    ["What happens with ambiguous or multi-topic questions?", "Retrieval may pull chunks from multiple sections; the LLM is prompted to synthesize across them and cite each source."],
    ["How would you measure retrieval quality?", "Recall@k and MRR against a small hand-written set of question-answer pairs with known source locations."],
    ["What are the limits of this system?", "It can't answer questions requiring information not present in the uploaded material, and multi-hop reasoning across many chunks is still an open challenge in RAG research."],
    ["Why a vector store instead of just keyword search?", "Semantic embeddings capture meaning, not just exact word overlap, so they retrieve relevant passages even when the wording differs from the question."],
    ["How is this different from just asking ChatGPT the question?", "ChatGPT alone can't see the specific course material and may answer from general knowledge, which can be wrong or off-syllabus; RAG grounds it in the actual source."],
  ],
  "Course PDFs are chunked and embedded into a vector store; a user's question retrieves the most relevant chunks, and an LLM answers strictly from those chunks with citations, retrying with a reformulated query if the first retrieval looks weak.",
  "Students often ask AI chatbots questions about their coursework and get plausible-sounding but wrong answers, because the model draws on general internet knowledge, not their actual syllabus. My system ingests the course's own PDFs, retrieves the most relevant passages for each question using semantic search, and has the AI answer strictly from those passages with citations back to the source - turning a generic chatbot into a grounded, trustworthy study assistant for one specific course."
);

vivaSection(
  "Proposal 3 - Explainable Resume-Job Matcher",
  [
    ["How is this different from a standard ATS keyword filter?", "ATS tools miss semantically equivalent skills phrased differently; my system uses embeddings to catch meaning-level matches, plus an explanation layer ATS tools don't provide."],
    ["Why use embeddings instead of just asking an LLM to score the match directly?", "Embeddings give a fast, consistent numeric score across many resumes; the LLM is then used for the harder task of explaining and suggesting edits, where its reasoning strength matters more."],
    ["How do you generate resume-edit suggestions responsibly?", "Suggestions are constrained to rephrasing existing, true experience to better match the job's language - not inventing new claims - and the prompt explicitly enforces this."],
    ["What's your evaluation baseline?", "Human-ranked resume/JD pairs I annotate myself, compared against the system's ranking via a correlation metric."],
    ["What happens with poorly formatted or scanned resumes?", "The LLM parser handles common text formats well; heavily scanned/image resumes would need an OCR step, which I flag as a known limitation, not solved in this scope."],
    ["Could this introduce bias?", "Yes, a real risk - embedding models can encode biases present in training data; I'd note this as a limitation and avoid using demographic-adjacent fields as matching signals."],
    ["Why not train a custom matching model?", "That requires large labeled interaction data and training infrastructure well beyond a solo, days-long project - pretrained embeddings plus LLM reasoning gets most of the practical value without that cost."],
    ["How do you handle synonyms/skill variants (e.g., ML vs machine learning)?", "Semantic embeddings largely handle this automatically since they capture meaning, not exact tokens; I can also add a normalization step for the most common variants."],
    ["What's the single biggest technical risk?", "Parsing accuracy on messy/unusual resume formats - mitigated with a manual-entry fallback if automated parsing fails."],
    ["How would this generalize beyond tech resumes?", "The pipeline is domain-agnostic; only the extracted skill vocabulary changes with the job field."],
  ],
  "Resume and job description are parsed into structured fields, embedded and compared for a similarity score, and an LLM reasoning layer explains the match and suggests concrete, truthful edits, all shown on a single dashboard.",
  "Most resume-matching tools give you a mysterious percentage score and nothing else. My system computes that score using semantic embeddings, but then goes further - it explains exactly which skills matched and which are missing, and suggests specific, honest rewording to close the gap, turning a black-box filter into an actionable coaching tool for job seekers."
);

// Section 6
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("6. Final Recommendation"));
children.push(pRuns([bold("Pick Proposal 1 (Question-Bank Generator) "), new TextRun("if you want the lowest-risk, fastest path to a polished demo, and especially because it's the one idea that maps directly onto work you already do (you create M.Tech course materials), which means you'll write a more convincing, detail-rich report and answer viva questions from genuine hands-on knowledge rather than a topic you learned for the project.")]));
children.push(pRuns([bold("Pick Proposal 2 (RAG Q&A Assistant) "), new TextRun("if you want the strongest looks technically advanced signal. RAG is currently the single most in-demand AI engineering pattern in industry, evaluators recognize the term immediately, and the architecture demonstrates more moving technical parts for the same build time.")]));
children.push(pRuns([bold("Pick Proposal 3 (Resume Matcher) "), new TextRun("if demo impact and general audience appeal matter most - everyone immediately understands the problem, and the explanation/suggestion feature has strong wow factor in a live demo.")]));
children.push(pRuns([bold("Overall recommendation: Proposal 1"), new TextRun(", for the personal-fit reason above - genuine familiarity with the domain is the single biggest lever for report depth and viva confidence, and it's fully achievable in your time window with room left over to add the RAG-based document ingestion from Proposal 2 as a future work extension if you want to show ambition in the report without needing to build it.")]));

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 16838 },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("E:\\ASAT(Main)\\backend\\BTech_Final_Year_Project_Research_Report.docx", buf);
  console.log("done");
});