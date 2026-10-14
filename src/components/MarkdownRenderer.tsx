import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // Split content by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-slate-200">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          return <CodeBlock key={index} raw={part} />;
        }
        return <TextBlock key={index} text={part} />;
      })}
    </div>
  );
};

const CodeBlock: React.FC<{ raw: string }> = ({ raw }) => {
  const [copied, setCopied] = useState(false);

  // Extract language and code
  const lines = raw.slice(3, -3).trim().split('\n');
  const firstLine = lines[0].trim();
  const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
  const language = hasLang ? firstLine : 'code';
  const codeContent = hasLang ? lines.slice(1).join('\n') : lines.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-cyan-500/20 bg-[#080d1a] shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#0e1628] border-b border-slate-800 text-[11px] font-mono text-slate-400">
        <span className="text-cyan-400 font-medium lowercase">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-sans text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="font-sans text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 text-xs font-mono text-slate-200 overflow-x-auto selection:bg-cyan-500/30">
        <code>{codeContent}</code>
      </pre>
    </div>
  );
};

const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  const paragraphs = text.split(/\n\n+/);

  return (
    <>
      {paragraphs.map((paragraph, pIdx) => {
        const trimmed = paragraph.trim();
        if (!trimmed) return null;

        // Check if paragraph is a list
        const lines = trimmed.split('\n');
        const isBulletList = lines.every((line) => line.trim().startsWith('- ') || line.trim().startsWith('* '));
        const isNumberedList = lines.every((line) => /^\d+\.\s/.test(line.trim()));

        if (isBulletList) {
          return (
            <ul key={pIdx} className="space-y-1 my-1.5 pl-1">
              {lines.map((item, iIdx) => {
                const itemContent = item.replace(/^[-*]\s+/, '');
                return (
                  <li key={iIdx} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 mt-2 shrink-0" />
                    <span>{renderInlineText(itemContent)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={pIdx} className="space-y-1.5 my-1.5 pl-1">
              {lines.map((item, iIdx) => {
                const match = item.match(/^(\d+)\.\s+(.*)/);
                const number = match ? match[1] : `${iIdx + 1}`;
                const itemContent = match ? match[2] : item;
                return (
                  <li key={iIdx} className="flex items-start gap-2">
                    <span className="text-xs font-mono text-cyan-400 font-semibold shrink-0 mt-0.5">
                      {number}.
                    </span>
                    <span>{renderInlineText(itemContent)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Check if blockquote
        if (trimmed.startsWith('>')) {
          const quoteText = trimmed.replace(/^>\s*/gm, '');
          return (
            <blockquote
              key={pIdx}
              className="pl-3 py-1 my-1 border-l-2 border-cyan-500/60 bg-cyan-950/15 rounded-r-lg text-slate-300 italic text-[13px]"
            >
              {renderInlineText(quoteText)}
            </blockquote>
          );
        }

        // Regular paragraph
        return (
          <p key={pIdx} className="my-1">
            {renderInlineText(trimmed)}
          </p>
        );
      })}
    </>
  );
};

// Parses inline bold, italics, inline code
function renderInlineText(raw: string): React.ReactNode {
  // Tokenize by inline code first
  const codeParts = raw.split(/(`[^`]+`)/g);

  return codeParts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 mx-0.5 text-xs font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 rounded"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold formatting **text**
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, bIdx) => {
      if (bPart.startsWith('**') && bPart.endsWith('**')) {
        return (
          <strong key={`${i}-${bIdx}`} className="font-semibold text-white">
            {bPart.slice(2, -2)}
          </strong>
        );
      }

      // Italic formatting *text*
      const italicParts = bPart.split(/(\*[^*]+\*)/g);
      return italicParts.map((iPart, itIdx) => {
        if (iPart.startsWith('*') && iPart.endsWith('*')) {
          return (
            <em key={`${i}-${bIdx}-${itIdx}`} className="italic text-slate-300">
              {iPart.slice(1, -1)}
            </em>
          );
        }
        return iPart;
      });
    });
  });
}
