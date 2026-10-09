import { describe, it, expect, vi } from 'vitest';
import app from '../../src/hono/webs';
import r2Service from '../../src/service/r2-service';
import s3Service from '../../src/service/s3-service';
import telegramService from '../../src/service/telegram-service';

describe('XSS Defense - r2Service.toObjResp across storage backends', () => {

  describe('KV backend', () => {
    it('forces attachment disposition, nosniff, and sandbox CSP for text/html', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('KV');
      const mockContext = {
        env: {
          kv: {
            getWithMetadata: vi.fn().mockResolvedValue({
              value: new TextEncoder().encode('<h1>Hello</h1>').buffer,
              metadata: {
                contentType: 'text/html; charset=utf-8',
                contentDisposition: 'inline; filename="index.html"',
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/index.html');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('forces attachment disposition, nosniff, and sandbox CSP for image/svg+xml', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('KV');
      const mockContext = {
        env: {
          kv: {
            getWithMetadata: vi.fn().mockResolvedValue({
              value: new TextEncoder().encode('<svg onload="alert(1)"></svg>').buffer,
              metadata: {
                contentType: 'image/svg+xml',
                contentDisposition: 'inline; filename="vector.svg"',
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/vector.svg');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('preserves inline disposition for safe images like image/png', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('KV');
      const mockContext = {
        env: {
          kv: {
            getWithMetadata: vi.fn().mockResolvedValue({
              value: new Uint8Array([1, 2, 3]).buffer,
              metadata: {
                contentType: 'image/png',
                contentDisposition: 'inline; filename="photo.png"',
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/photo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('inline;');
    });
  });

  describe('R2 backend', () => {
    it('forces attachment disposition, nosniff, and sandbox CSP for text/html', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('R2');
      const mockContext = {
        env: {
          r2: {
            get: vi.fn().mockResolvedValue({
              body: '<h1>Hello R2</h1>',
              httpEtag: '"mock-etag"',
              writeHttpMetadata: (headers) => {
                headers.set('content-type', 'text/html');
                headers.set('content-disposition', 'inline; filename="test.html"');
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/test.html');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('forces attachment disposition, nosniff, and sandbox CSP for image/svg+xml', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('R2');
      const mockContext = {
        env: {
          r2: {
            get: vi.fn().mockResolvedValue({
              body: '<svg></svg>',
              httpEtag: '"mock-etag"',
              writeHttpMetadata: (headers) => {
                headers.set('content-type', 'image/svg+xml');
                headers.set('content-disposition', 'inline; filename="vector.svg"');
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/vector.svg');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('preserves inline disposition for safe images like image/png', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('R2');
      const mockContext = {
        env: {
          r2: {
            get: vi.fn().mockResolvedValue({
              body: 'fake-png-body',
              httpEtag: '"mock-etag"',
              writeHttpMetadata: (headers) => {
                headers.set('content-type', 'image/png');
                headers.set('content-disposition', 'inline; filename="photo.png"');
              },
            }),
          },
        },
      };

      const res = await r2Service.toObjResp(mockContext, 'attachments/photo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('inline;');
    });
  });

  describe('S3 backend', () => {
    it('forces attachment disposition, nosniff, and sandbox CSP for text/html', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('S3');
      vi.spyOn(s3Service, 'getObj').mockResolvedValue({
        Body: '<h1>Hello S3</h1>',
        ContentType: 'text/html',
        ContentDisposition: 'inline; filename="doc.html"',
      });

      const res = await r2Service.toObjResp({}, 'attachments/doc.html');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('forces attachment disposition, nosniff, and sandbox CSP for image/svg+xml', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('S3');
      vi.spyOn(s3Service, 'getObj').mockResolvedValue({
        Body: '<svg></svg>',
        ContentType: 'image/svg+xml',
        ContentDisposition: 'inline; filename="vector.svg"',
      });

      const res = await r2Service.toObjResp({}, 'attachments/vector.svg');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
      expect(res.headers.get('Content-Disposition')).not.toMatch(/^\s*inline/i);
    });

    it('preserves inline disposition for safe images like image/png', async () => {
      vi.spyOn(r2Service, 'storageType').mockResolvedValue('S3');
      vi.spyOn(s3Service, 'getObj').mockResolvedValue({
        Body: 'fake-png-body',
        ContentType: 'image/png',
        ContentDisposition: 'inline; filename="photo.png"',
      });

      const res = await r2Service.toObjResp({}, 'attachments/photo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
      expect(res.headers.get('Content-Disposition')).toContain('inline;');
    });
  });
});

describe('XSS Defense - /oss/* endpoint', () => {
  it('delegates to r2Service.toObjResp and returns secure response', async () => {
    vi.spyOn(r2Service, 'toObjResp').mockResolvedValueOnce(
      new Response('<h1>Hello</h1>', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': 'attachment; filename="file.html"',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none';",
        },
      })
    );

    const res = await app.request('/oss/test-key-html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none';");
    expect(res.headers.get('Content-Disposition')).toContain('attachment;');
  });
});

describe('XSS Defense - /telegram/getEmail/:token endpoint', () => {
  it('sets nonce-based script-src CSP and security headers for HTML email', async () => {
    vi.spyOn(telegramService, 'getEmailContent').mockImplementationOnce(async (c, params, nonce) => {
      return {
        type: 'html',
        content: `<!DOCTYPE html><script nonce="${nonce}">console.log(1);</script>`,
      };
    });

    const res = await app.request('/telegram/getEmail/mock-token');
    expect(res.status).toBe(200);

    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[a-f0-9-]+'/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets strict script-less CSP for plain text email', async () => {
    vi.spyOn(telegramService, 'getEmailContent').mockResolvedValueOnce({
      type: 'text',
      content: '<span>Plain text message</span>',
    });

    const res = await app.request('/telegram/getEmail/mock-token');
    expect(res.status).toBe(200);

    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src https: data:;");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
