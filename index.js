#!/usr/bin/env node
import 'dotenv/config';
import input from '@inquirer/input';
import select from '@inquirer/select';
import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import fs from 'node:fs';
import { Octokit } from '@octokit/core';

// 1. Fetch data from GitHub API
async function fetchGitHubData(username, token) {
  const authToken = token || process.env.GITHUB_TOKEN;

  const octokit = new Octokit({
    auth: authToken || undefined,
  });

  const query = `
    query getProfileAndPinned($username: String!) {
      user(login: $username) {
        name
        login
        bio
        location
        company
        websiteUrl
        followers { totalCount }
        repositories(first: 6, orderBy: {field: STARGAZERS, direction: DESC}) {
          totalCount
          nodes {
            name
            description
            url
            stargazerCount
            forkCount
            primaryLanguage { name }
            repositoryTopics(first: 5) { nodes { topic { name } } }
          }
        }
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes {
            ... on Repository {
              name
              description
              url
              stargazerCount
              forkCount
              primaryLanguage { name }
              repositoryTopics(first: 5) { nodes { topic { name } } }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await octokit.graphql(query, { username });
    const user = response?.user;

    if (!user) {
      throw new Error(`User "${username}" was not found on GitHub.`);
    }

    // Use pinned repos if available; otherwise fallback to top-starred repos
    const pinnedNodes = user.pinnedItems?.nodes || [];
    const repoNodes = user.repositories?.nodes || [];
    const rawRepos = pinnedNodes.length > 0 ? pinnedNodes : repoNodes;

    const projects = rawRepos.map((repo) => ({
      name: repo.name,
      description: repo.description || 'No description provided.',
      url: repo.url,
      stars: repo.stargazerCount || 0,
      forks: repo.forkCount || 0,
      language: repo.primaryLanguage?.name || 'N/A',
      topics: repo.repositoryTopics?.nodes?.map((t) => t.topic.name) || [],
    }));

    // Auto-extract skills from languages and topics
    const skillsSet = new Set();
    projects.forEach((p) => {
      if (p.language !== 'N/A') skillsSet.add(p.language);
      p.topics.forEach((topic) => skillsSet.add(topic));
    });

    return {
      name: user.name || user.login,
      handle: user.login,
      bio: user.bio || 'Software Developer',
      location: user.location || 'Remote',
      company: user.company || 'Independent Developer',
      website: user.websiteUrl || `https://github.com/${user.login}`,
      followers: user.followers?.totalCount || 0,
      totalRepos: user.repositories?.totalCount || 0,
      projects,
      skills: Array.from(skillsSet),
    };
  } catch (err) {
    if (err.status === 401) {
      throw new Error('Invalid GitHub Personal Access Token provided.');
    }
    if (err.message && err.message.includes('rate limit')) {
      throw new Error('GitHub API rate limit exceeded. Please provide a Personal Access Token.');
    }
    throw err;
  }
}

// 2. Render Terminal Layout
function renderResume(data) {
  const header = `
${chalk.bold.cyan(data.name)} (@${chalk.dim(data.handle)})
${chalk.italic(data.bio)}

📍 ${chalk.white(data.location)}  |  🏢 ${chalk.white(data.company)}  |  🔗 ${chalk.white(data.website)}
👥 Followers: ${chalk.yellow(data.followers)}  |  📦 Repositories: ${chalk.yellow(data.totalRepos)}
  `.trim();

  const skillsList =
    data.skills.length > 0
      ? data.skills.map((s) => chalk.bgCyan.black(` ${s} `)).join(' ')
      : chalk.dim('No skills detected.');

  const projectsList = data.projects
    .map(
      (p) => `
${chalk.bold.green(`• ${p.name}`)} (${chalk.magenta(p.language)}) — ⭐ ${p.stars} | 🍴 ${p.forks}
  ${chalk.dim(p.description)}
  🔗 ${chalk.underline.blue(p.url)}
  `
    )
    .join('\n');

  const content = `
${header}

${chalk.bold.yellow('🛠️  SKILLS & TECHNOLOGIES')}
${skillsList}

${chalk.bold.yellow('📌 FEATURED / PINNED PROJECTS')}
${projectsList}
  `;

  console.log(
    boxen(content, {
      padding: 1,
      margin: 1,
      borderColor: 'cyan',
      borderStyle: 'round',
      title: 'GitHub Developer Resume',
      titleAlignment: 'center',
    })
  );
}

// 3. Export Resume as Markdown
function exportMarkdown(data) {
  const filename = `${data.handle}_resume.md`;

  const md = `
# ${data.name} (@${data.handle})
> ${data.bio}

- **Location:** ${data.location}
- **Company:** ${data.company}
- **Website:** ${data.website}

---

## 🛠️ Skills
${data.skills.map((s) => `- \`${s}\``).join('\n')}

---

## 📌 Featured Projects
${data.projects
  .map(
    (p) => `
### [${p.name}](${p.url}) (${p.language})
*⭐ ${p.stars} | 🍴 ${p.forks}*

${p.description}
`
  )
  .join('\n')}
  `.trim();

  fs.writeFileSync(filename, md);
  console.log(chalk.green(`\n✅ Resume saved to ${chalk.bold(filename)}`));
}

// 4. Main Program Loop
async function main() {
  console.clear();
  console.log(chalk.bold.cyan('\n🚀 Terminal GitHub Resume Generator\n'));

  const username = await input({
    message: 'Enter GitHub username:',
    validate: (val) => (val.trim().length > 0 ? true : 'Please enter a valid username.'),
  });

  let token = process.env.GITHUB_TOKEN;

  if (!token) {
    token = await input({
      message: 'Enter GitHub Personal Access Token (Optional, press Enter to skip):',
    });
  }

  const spinner = ora(`Fetching profile for @${username}...`).start();

  try {
    const data = await fetchGitHubData(username.trim(), token ? token.trim() : null);
    spinner.succeed('Profile loaded successfully!');

    renderResume(data);

    const action = await select({
      message: 'Choose an option:',
      choices: [
        { name: '📄 Save as Markdown (.md)', value: 'export' },
        { name: '❌ Exit', value: 'exit' },
      ],
    });

    if (action === 'export') {
      exportMarkdown(data);
    }
  } catch (err) {
    spinner.fail('Failed to fetch user data.');
    console.error(chalk.red(`\nError: ${err.message}`));

    if (err.message && err.message.includes('rate limit')) {
      console.log(
        chalk.yellow(
          '\n💡 Tip: GitHub API rate limit exceeded. Get a free Personal Access Token at https://github.com/settings/tokens and paste it when prompted.'
        )
      );
    }
  }
}

main();