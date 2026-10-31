# Faculty Publication Analyzer

Type a professor's name and see their recent publications analyzed: papers per year, senior/first-author share, citations, research themes, collaborators and journals. Every paper links to Google Scholar, DOI and PubMed.

Live site: https://dhruv-gada.github.io/prof-pubs/

## Data sources
- **OpenAlex**: works, citations, topics, h-index. Needs a free API key from https://openalex.org/settings/api (paste it under "Data settings"; it stays in your browser).
- **PubMed** (NCBI E-utilities): cross-check and fallback, no key needed.
- **Google Scholar** has no public API, so it is linked rather than queried.

It's a single static `index.html` with no build step. Open it locally or host it anywhere.
