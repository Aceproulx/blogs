---
title: "Intigriti Santa Cloud Writeup"
date: "2026-04-28"
tags: ["CTF", "Security", "Web"]
author: "Admin"
---

# Intigriti Santa Cloud Writeup

This is a sample writeup to demonstrate the blog site.

## Introduction
Quick directory scan revealed a `robots.txt` file.

```javascript
// Sample code snippet
const fetchFlags = async () => {
  const res = await fetch('/api/notes?user_id=1');
  const data = await res.json();
  console.log(data);
};
```

## Findings
We found user credentials in the `composer.json~` file.

- **Vulnerability**: IDOR
- **Impact**: Information Disclosure
