import { describe, it, expect } from 'vitest';
import emailHtmlTemplate from '../../src/template/email-html';

describe('emailHtmlTemplate', () => {
  it('safely embeds HTML containing backticks and ${...} without template injection', () => {
    const maliciousHtml = '<p>Use `rm -rf /` and ${process.env.SECRET} here</p>';
    const result = emailHtmlTemplate(maliciousHtml, 'example.com');

    // The output should contain safe JSON string without raw unescaped template backticks breaking the script
    expect(result).toContain('const exampleHtml = "');
    expect(result).toContain('Use `rm -rf /` and ${process.env.SECRET}');
  });

  it('safely escapes closing </script> tags in content using \\u003C', () => {
    const scriptBreakoutHtml = '<p>hello</p></script><script>alert(1)</script>';
    const result = emailHtmlTemplate(scriptBreakoutHtml, 'example.com');

    // Should not contain literal </script> inside the string assignment
    expect(result).not.toContain('const exampleHtml = "</script>');
    expect(result).toContain('\\u003C');
  });

  it('strips <script> tags from the source HTML', () => {
    const htmlWithScript = '<div>Content</div><script>console.log("bad")</script>';
    const result = emailHtmlTemplate(htmlWithScript, 'example.com');

    expect(result).not.toContain('console.log("bad")');
    expect(result).toContain('Content');
  });

  it('replaces {{domain}} with oss domain', () => {
    const htmlWithDomain = '<img src="{{domain}}test.png">';
    const result = emailHtmlTemplate(htmlWithDomain, 'example.com');

    expect(result).not.toContain('{{domain}}');
  });
});
