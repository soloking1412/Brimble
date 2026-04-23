const port = Number(process.env.PORT || 3000);

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hello from Brimble</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: linear-gradient(160deg, #f8fafc 0%, #dbeafe 100%);
        color: #0f172a;
      }
      main {
        max-width: 720px;
        margin: 72px auto;
        padding: 32px;
      }
      .card {
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 40px;
      }
      p {
        margin: 0;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Hello from Brimble</h1>
        <p>This sample app is bundled with the submission so the upload flow can be tested without cloning a repository.</p>
      </section>
    </main>
  </body>
</html>`;

const http = await import('node:http');

http
  .createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  })
  .listen(port, '0.0.0.0');
