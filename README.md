# GmapsScraper

This project contains a simple proof-of-concept Google Maps scraper built with [Puppeteer](https://github.com/puppeteer/puppeteer). It scrolls through search results, navigates pages and collects place names from the results list.

## Prerequisites

- Node.js (tested with `v22`)
- A modern version of npm

## Installation

```bash
npm install
```

## Running the scraper

The main entry point is `index.js`. You can start the scraper with:

```bash
npm start
```

By default the script opens a non-headless Chromium window and navigates to a sample food search around a hard coded location. Adjust the URL in `index.js` to change the search query.

## Caveats

This scraper is only a minimal demonstration and may break if Google changes the page structure. Use responsibly and follow the Google Maps terms of service.

