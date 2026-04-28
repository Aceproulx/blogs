import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Home, Tag, Archive, User, Search, Calendar, Clock } from 'lucide-react';
import postsMetadata from './posts-metadata.json';

const Sidebar = () => (
  <div className="sidebar">
    <div className="site-title">Trafiiik Clone</div>
    <ul className="nav-links">
      <li className="nav-item">
        <Link to="/" className="nav-link"><Home size={20} /> HOME</Link>
      </li>
      <li className="nav-item">
        <Link to="/categories" className="nav-link"><Archive size={20} /> CATEGORIES</Link>
      </li>
      <li className="nav-item">
        <Link to="/tags" className="nav-link"><Tag size={20} /> TAGS</Link>
      </li>
      <li className="nav-item">
        <Link to="/about" className="nav-link"><User size={20} /> ABOUT</Link>
      </li>
    </ul>
  </div>
);

const BlogCard = ({ post }) => (
  <Link to={`/post/${post.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
    <div className="blog-card">
      <div className="blog-meta">
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> {post.date}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> 5 min read</span>
      </div>
      <h2>{post.title}</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{post.excerpt}</p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {post.tags.map(tag => (
          <span key={tag} className="tag">{tag}</span>
        ))}
      </div>
    </div>
  </Link>
);

const BlogList = () => (
  <div className="blog-list">
    <h1 style={{ marginBottom: '2rem' }}>Recent Posts</h1>
    {postsMetadata.map(post => (
      <BlogCard key={post.slug} post={post} />
    ))}
  </div>
);

const BlogPost = () => {
  const { slug } = useParams();
  const post = postsMetadata.find(p => p.slug === slug);

  if (!post) return <div>Post not found</div>;

  return (
    <div className="post-view">
      <div className="post-header">
        <div className="blog-meta">
          <span>{post.date}</span>
          {post.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
        </div>
        <h1 className="post-title">{post.title}</h1>
      </div>
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  {...props}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
          }}
        >
          {post.content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<BlogList />} />
            <Route path="/post/:slug" element={<BlogPost />} />
            <Route path="*" element={<div>Page not found</div>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
