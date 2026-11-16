export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const statusLabel = { draft: 'Draft', open: 'Open', closed: 'Closed' };
const status = (value) => '<span class="status ' + value + '">' + statusLabel[value] + '</span>';
const pathFor = (item) => '/elections/' + item.id;

export function page(title, body, user) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} | Campus Ballot</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><nav class="shell" aria-label="Main navigation">
<a class="brand" href="/"><span class="brand-mark" aria-hidden="true">&#10003;</span> Campus Ballot</a>
${user ? `<div class="account"><span>${escape(user.email)}</span><form action="/logout" method="post"><button class="secondary">Sign out</button></form></div>`
  : '<a href="/register">Register to vote</a>'}
</nav></header>
<main class="shell">${body}</main>
</body>
</html>`;
}

export function access(mode) {
  const signingIn = mode === 'login';
  return `<div class="entry">
<section class="intro"><h1>Campus elections</h1><p>Cast your vote in active elections and see the results once polls close.</p></section>
<section class="panel">
<h2>${signingIn ? 'Sign in' : 'Create a voter account'}</h2>
<form class="fields" action="/${mode}" method="post">
<label>Email address<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
<label>Password<input name="password" type="password" autocomplete="${signingIn ? 'current-password' : 'new-password'}" minlength="12" maxlength="128" required></label>
${signingIn ? '' : '<p class="hint">Use at least 12 characters.</p>'}
<button>${signingIn ? 'Sign in' : 'Create account'}</button>
</form>
<p class="hint">${signingIn ? 'New voter? <a href="/register">Create an account</a>' : 'Already registered? <a href="/">Sign in</a>'}</p>
</section></div>`;
}

export function dashboard(rows, user) {
  return `<section class="heading"><h1>${user.role === 'admin' ? 'Manage elections' : 'Elections'}</h1></section>
<div class="dashboard">
<section aria-label="Election list">
${rows.length ? `<ul class="cards">${rows.map((item) => `<li class="panel election-card">
<div class="card-title"><h2><a href="${pathFor(item)}">${escape(item.title)}</a></h2>${status(item.status)}</div>
${item.description ? '<p>' + escape(item.description) + '</p>' : ''}
${item.voted ? '<p class="hint">Ballot recorded</p>' : ''}
<a class="detail-link" href="${pathFor(item)}">${item.status === 'closed' ? 'View results' : 'View election'} &rarr;</a>
</li>`).join('')}</ul>` : '<p class="panel">There are no elections to show yet.</p>'}
</section>
${user.role === 'admin' ? `<section class="panel create">
<h2>Create an election</h2>
<form class="fields" action="/elections" method="post">
<label>Title<input name="title" maxlength="100" required></label>
<label>Description<textarea name="description" maxlength="500" rows="3"></textarea></label>
<label>Candidates, one per line<textarea name="candidates" rows="4" maxlength="1620" required></textarea></label>
<button>Create draft</button>
</form>
</section>` : ''}
</div>`;
}

export function electionPage(item, candidates, results, participation, user) {
  const url = pathFor(item);
  let content;
  if (item.status === 'closed') {
    const total = results.reduce((sum, row) => sum + Number(row.votes), 0);
    content = `<h2>Results</h2><p>Total ballots cast <strong>${total}</strong></p>
<table><thead><tr><th scope="col">Candidate</th><th scope="col">Votes</th><th scope="col">Share</th></tr></thead>
<tbody>${results.map((row) => `<tr><th scope="row">${escape(row.name)}</th><td>${Number(row.votes)}</td><td>${total ? (100 * Number(row.votes) / total).toFixed(1) : '0.0'}%</td></tr>`).join('')}</tbody></table>`;
  } else if (item.status === 'open' && user.role === 'voter' && !participation) {
    content = `<form class="fields" action="${url}/vote" method="post">
<fieldset><legend>Choose one candidate</legend>
${candidates.map(({ id, name }) => `<label class="choice"><input type="radio" name="candidate" value="${id}" required> ${escape(name)}</label>`).join('')}
</fieldset><p class="hint">You can submit one ballot in this election.</p><button>Cast ballot</button></form>`;
  } else {
    content = '<h2>Candidates</h2><ul>' + candidates.map(({ name }) => '<li>' + escape(name) + '</li>').join('') + '</ul>';
  }
  const action = item.status === 'draft' ? 'open' : 'close';
  const controls = user.role === 'admin' && item.status !== 'closed'
    ? `<form class="controls" action="${url}/${action}" method="post"><button>${action === 'open' ? 'Open voting' : 'Close voting and publish results'}</button></form>` : '';
  return `<a class="back" href="/">&larr; All elections</a>
<section class="heading">${status(item.status)}<h1>${escape(item.title)}</h1>${item.description ? '<p>' + escape(item.description) + '</p>' : ''}</section>
${participation ? '<p class="notice" role="status">Your ballot has been recorded.</p>' : ''}
<section class="panel detail">${content}${controls}</section>`;
}
