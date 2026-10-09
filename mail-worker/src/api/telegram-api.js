import app from '../hono/hono';
import telegramService from '../service/telegram-service';

app.get('/telegram/getEmail/:token', async (c) => {
	const nonce = crypto.randomUUID();
	const result = await telegramService.getEmailContent(c, c.req.param(), nonce);

	c.header('Cache-Control', 'public, max-age=604800, immutable');
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('X-Frame-Options', 'DENY');

	if (result?.type === 'html') {
		c.header(
			'Content-Security-Policy',
			`default-src 'none'; script-src 'nonce-${nonce}'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src https: data:;`
		);
	} else {
		c.header(
			'Content-Security-Policy',
			"default-src 'none'; style-src 'unsafe-inline'; font-src https: data:;"
		);
	}

	return c.html(result?.content || '');
});

