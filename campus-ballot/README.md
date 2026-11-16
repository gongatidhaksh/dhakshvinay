# Campus Ballot

MySQL 8 Online Voting Management System for a DBMS classroom demonstration. Admins create elections and control when voting opens and closes. Voters register, choose one candidate, and see the results once voting closes.

## Run locally

Install Node.js 24 and MySQL 8.0.16 or newer. Create an empty database named campus_ballot, then give a dedicated MySQL user access to that database. Run these commands from the extracted project folder. Replace the connection details and admin credentials with your own. URL-encode any reserved characters in the MySQL username or password.

```powershell
npm install
$env:MYSQL_URL = 'mysql://ballot_user:db_password@127.0.0.1:3306/campus_ballot'
$env:ADMIN_EMAIL = 'admin@example.com'
$env:ADMIN_PASSWORD = 'replace-with-a-strong-password'
npm start
```

Open http://localhost:3000. The app creates its tables and results view at startup. The database user needs CREATE, CREATE VIEW, DROP (for replacing the view), SELECT, INSERT, UPDATE, DELETE and REFERENCES on this database. The admin environment variables create the initial administrator. Changing ADMIN_PASSWORD in the environment later leaves that account's password in place.

## Deploy the web app on Render

1. Create an empty database on a MySQL 8 host that Render can reach. Enable TLS for an external database and get its host, port, database name and credentials.
2. Put the extracted files at the root of a GitHub repository. Include render.yaml and .gitignore.
3. In the [Render dashboard](https://dashboard.render.com/), select **New > Blueprint** and connect the repository.
4. Enter MYSQL_URL, ADMIN_EMAIL, and ADMIN_PASSWORD in the Blueprint setup. Keep these values in Render's environment settings. MYSQL_TLS defaults to true on Render. If your database host supplies a CA certificate, add it as MYSQL_CA_CERT in the web service's environment settings.
5. Apply the Blueprint. When the service is live, open its onrender.com URL, check that /health returns ok, and sign in as admin.

The Blueprint selects the free Render web plan and connects to an existing MySQL database. Database hosting is provisioned separately. To host MySQL itself on Render, use a [Render MySQL private service with a persistent disk](https://render.com/docs/deploy-mysql) in the same region. Set MYSQL_URL using the service's internal host and port. If that private MySQL instance is configured without TLS, set MYSQL_TLS to false. The private service and disk are paid resources.

## Demo walkthrough

1. Sign in as admin. Create a draft named Student Council President with two candidates, one per line. Open voting.
2. In a separate browser profile or private window, register a voter. Open the election and cast a ballot.
3. Reopen the election as that voter and check the ballot confirmation.
4. As admin, close voting. Check that the results include vote counts, percentages, and candidates with zero votes.

## Database design

See DBMS.md for the ER diagram, constraints, transaction walkthrough, and example queries. This classroom demo uses email and password accounts with open voter registration.
