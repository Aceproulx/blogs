import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const writeupsDir = path.join(process.cwd(), 'writeups');
const outputDir = path.join(process.cwd(), 'src');
const outputFile = path.join(outputDir, 'posts-metadata.json');

const generateMetadata = () => {
  if (!fs.existsSync(writeupsDir)) {
    console.error('writeups directory not found');
    return;
  }

  const files = fs.readdirSync(writeupsDir).filter(file => file.endsWith('.md'));
  const posts = files.map(file => {
    const filePath = path.join(writeupsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);
    
    // Create a slug from the filename
    const slug = file.replace('.md', '');
    
    return {
      slug,
      title: data.title || slug,
      date: data.date || new Date().toISOString().split('T')[0],
      tags: data.tags || [],
      excerpt: body.slice(0, 150).trim() + '...',
      content: body
    };
  });

  // Sort by date descending
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, JSON.stringify(posts, null, 2));
  console.log(`Generated metadata for ${posts.length} posts.`);
};

generateMetadata();
