import React from "react";
import { useApp } from "../context/AppContext";
import { User, FileText, CheckCircle2 } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { db, setCurrentView, setSelectedEntityId } = useApp();

  const handlePersonClick = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("pessoas");
  };

  const handleNoteClick = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("notas");
  };

  // Helper to parse inline elements: bold, italic, @person mentions, [[note]] links
  const parseInlineStyles = (text: string): React.ReactNode[] => {
    if (!text) return [];

    let parts: { type: "text" | "bold" | "italic" | "person" | "note"; content: string; id?: string }[] = [
      { type: "text", content: text },
    ];

    // 1. Match [[Note Title]]
    const noteRegex = /\[\[(.*?)\]\]/g;
    let newParts: typeof parts = [];
    for (const part of parts) {
      if (part.type !== "text") {
        newParts.push(part);
        continue;
      }
      let lastIndex = 0;
      let match;
      const contentStr = part.content;
      noteRegex.lastIndex = 0; // reset
      while ((match = noteRegex.exec(contentStr)) !== null) {
        const matchIndex = match.index;
        const matchText = match[0];
        const noteTitle = match[1].trim();

        // Add text before match
        if (matchIndex > lastIndex) {
          newParts.push({ type: "text", content: contentStr.substring(lastIndex, matchIndex) });
        }

        // Try to find note
        const matchingNote = db.notes.find(
          (n) => n.title.toLowerCase() === noteTitle.toLowerCase() || n.id === noteTitle
        );

        if (matchingNote) {
          newParts.push({ type: "note", content: matchingNote.title, id: matchingNote.id });
        } else {
          newParts.push({ type: "text", content: matchText });
        }
        lastIndex = noteRegex.lastIndex;
      }
      if (lastIndex < contentStr.length) {
        newParts.push({ type: "text", content: contentStr.substring(lastIndex) });
      }
    }
    parts = newParts;

    // 2. Match @Person Name
    // We sort names by length descending to match full names first before matching partial first names
    const sortedPeople = [...db.people].sort((a, b) => b.name.length - a.name.length);

    newParts = [];
    for (const part of parts) {
      if (part.type !== "text") {
        newParts.push(part);
        continue;
      }

      let contentStr = part.content;
      let lastIndex = 0;
      
      // We look for any @ followed by word characters/spaces
      const personRegex = /@([A-Za-z0-9À-ÿ\s.-]+?)(?=[.,;:!?]|\s|$)/g;
      let match;
      
      while ((match = personRegex.exec(contentStr)) !== null) {
        const matchIndex = match.index;
        const matchText = match[0];
        const searchedName = match[1].trim();

        if (matchIndex > lastIndex) {
          newParts.push({ type: "text", content: contentStr.substring(lastIndex, matchIndex) });
        }

        // Look up person in sorted list
        const matchingPerson = sortedPeople.find(
          (p) =>
            p.name.toLowerCase() === searchedName.toLowerCase() ||
            p.name.toLowerCase().startsWith(searchedName.toLowerCase()) ||
            p.id === searchedName
        );

        if (matchingPerson) {
          newParts.push({ type: "person", content: matchingPerson.name, id: matchingPerson.id });
        } else {
          newParts.push({ type: "text", content: matchText });
        }
        lastIndex = personRegex.lastIndex;
      }
      if (lastIndex < contentStr.length) {
        newParts.push({ type: "text", content: contentStr.substring(lastIndex) });
      }
    }
    parts = newParts;

    // 3. Match bold **text**
    newParts = [];
    const boldRegex = /\*\*(.*?)\*\*/g;
    for (const part of parts) {
      if (part.type !== "text") {
        newParts.push(part);
        continue;
      }
      let lastIndex = 0;
      let match;
      const contentStr = part.content;
      boldRegex.lastIndex = 0;
      while ((match = boldRegex.exec(contentStr)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
          newParts.push({ type: "text", content: contentStr.substring(lastIndex, matchIndex) });
        }
        newParts.push({ type: "bold", content: match[1] });
        lastIndex = boldRegex.lastIndex;
      }
      if (lastIndex < contentStr.length) {
        newParts.push({ type: "text", content: contentStr.substring(lastIndex) });
      }
    }
    parts = newParts;

    // 4. Match italic *text*
    newParts = [];
    const italicRegex = /\*(.*?)\*/g;
    for (const part of parts) {
      if (part.type !== "text") {
        newParts.push(part);
        continue;
      }
      let lastIndex = 0;
      let match;
      const contentStr = part.content;
      italicRegex.lastIndex = 0;
      while ((match = italicRegex.exec(contentStr)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
          newParts.push({ type: "text", content: contentStr.substring(lastIndex, matchIndex) });
        }
        newParts.push({ type: "italic", content: match[1] });
        lastIndex = italicRegex.lastIndex;
      }
      if (lastIndex < contentStr.length) {
        newParts.push({ type: "text", content: contentStr.substring(lastIndex) });
      }
    }
    parts = newParts;

    // Map to JSX
    return parts.map((part, idx) => {
      switch (part.type) {
        case "bold":
          return <strong key={idx}>{part.content}</strong>;
        case "italic":
          return <em key={idx}>{part.content}</em>;
        case "person":
          return (
            <span key={idx} className="mention-badge" onClick={() => handlePersonClick(part.id!)}>
              <User size={10} style={{ marginRight: "2px" }} />
              {part.content}
            </span>
          );
        case "note":
          return (
            <span key={idx} className="note-badge-link" onClick={() => handleNoteClick(part.id!)}>
              <FileText size={10} style={{ marginRight: "2px" }} />
              {part.content}
            </span>
          );
        default:
          return <React.Fragment key={idx}>{part.content}</React.Fragment>;
      }
    });
  };

  // Split lines and parse blocks
  const lines = content.split("\n");
  const parsedBlocks: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const renderList = (items: React.ReactNode[], key: number) => (
    <ul key={key} style={{ paddingLeft: "24px", marginBottom: "12px" }}>
      {items}
    </ul>
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Checklist Item: "- [ ] task" or "- [x] task"
    const checklistMatch = line.match(/^-\s*\[([ xX])\]\s*(.*)/);
    if (checklistMatch) {
      if (inList) {
        parsedBlocks.push(renderList(listItems, i - 1));
        listItems = [];
        inList = false;
      }
      const checked = checklistMatch[1].toLowerCase() === "x";
      const taskText = checklistMatch[2];
      parsedBlocks.push(
        <div key={i} className="markdown-task-item" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <CheckCircle2
            size={16}
            style={{
              color: checked ? "var(--color-text-main)" : "var(--color-text-muted)",
              fill: checked ? "var(--color-text-main)" : "transparent",
              cursor: "default"
            }}
          />
          <span style={{ fontSize: "13px", textDecoration: checked ? "line-through" : "none", color: checked ? "var(--color-text-muted)" : "inherit" }}>
            {parseInlineStyles(taskText)}
          </span>
        </div>
      );
      continue;
    }

    // Bullet List Item: "- item"
    const bulletMatch = line.match(/^-\s+(.*)/);
    if (bulletMatch) {
      inList = true;
      listItems.push(<li key={i} style={{ fontSize: "13px", marginBottom: "4px" }}>{parseInlineStyles(bulletMatch[1])}</li>);
      continue;
    }

    // If list is active but line is not a list item, render list and close it
    if (inList && !bulletMatch) {
      parsedBlocks.push(renderList(listItems, i - 1));
      listItems = [];
      inList = false;
    }

    // Empty lines
    if (line.trim() === "") {
      parsedBlocks.push(<div key={i} style={{ height: "12px" }} />);
      continue;
    }

    // Headers
    if (line.startsWith("# ")) {
      parsedBlocks.push(<h1 key={i}>{parseInlineStyles(line.substring(2))}</h1>);
    } else if (line.startsWith("## ")) {
      parsedBlocks.push(<h2 key={i}>{parseInlineStyles(line.substring(3))}</h2>);
    } else if (line.startsWith("### ")) {
      parsedBlocks.push(<h3 key={i}>{parseInlineStyles(line.substring(4))}</h3>);
    }
    // Blockquote
    else if (line.startsWith("> ")) {
      parsedBlocks.push(<blockquote key={i}>{parseInlineStyles(line.substring(2))}</blockquote>);
    }
    // Standard Paragraph
    else {
      parsedBlocks.push(<p key={i}>{parseInlineStyles(line)}</p>);
    }
  }

  // Handle remaining list
  if (inList) {
    parsedBlocks.push(renderList(listItems, lines.length - 1));
  }

  return <div className="markdown-body">{parsedBlocks}</div>;
};
