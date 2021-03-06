const debug = require('debug')('publikator:mutation:commit')
const { hashObject } = require('../../../lib/git')
const { upsert: repoCacheUpsert } = require('../../../lib/cache/upsert')
const visit = require('unist-util-visit')
const dataUriToBuffer = require('data-uri-to-buffer')
const MDAST = require('@orbiting/remark-preset')
const {
  lib: { unprefixUrl },
} = require('@orbiting/backend-modules-assets')
const {
  Roles: { ensureUserHasRole },
} = require('@orbiting/backend-modules-auth')
const superb = require('superb')
const superheroes = require('superheroes')
const sleep = require('await-sleep')
const sharp = require('sharp')
const slugify = require('slugify')
const fetch = require('isomorphic-unfetch')
const {
  createGithubClients,
  commitNormalizer,
  getRepo,
  getHeads,
  gitAuthor,
} = require('../../../lib/github')
const {
  lib: {
    process: {
      processRepoImageUrlsInContent,
      processRepoImageUrlsInMeta,
      processImageUrlsInContent,
    },
  },
} = require('@orbiting/backend-modules-documents')

const { ASSETS_SERVER_BASE_URL } = process.env

const generateImageData = async (blob) => {
  const meta = await sharp(blob).metadata()
  const suffix = meta.format
  const hash = hashObject(blob)
  const path = `images/${hash}.${suffix}`
  const imageUrl = `${path}?size=${meta.width}x${meta.height}`
  return {
    image: {
      path,
      hash,
      blob,
    },
    imageUrl,
  }
}

const extractImage = async (url, images) => {
  if (url) {
    let blob
    try {
      blob = dataUriToBuffer(url)
    } catch (e) {
      /* console.log('ignoring image node with url:' + url) */
    }
    if (blob) {
      const { image, imageUrl } = await generateImageData(blob)
      images.push(image)
      return imageUrl
    }
  }
  return url
}

const isFromDifferentRepo = (url, repoId) =>
  url &&
  url.startsWith(`${ASSETS_SERVER_BASE_URL}/github/`) &&
  !url.includes(repoId)

const importFromRepo = async (url, images, repoId) => {
  if (isFromDifferentRepo(url, repoId)) {
    try {
      const blob = await fetch(url).then((result) => result.buffer())
      const { image, imageUrl } = await generateImageData(blob)
      images.push(image)
      return imageUrl
    } catch (e) {
      console.error('failed to transfer image', repoId, url, e)
    }
  }
  return url
}

module.exports = async (_, args, context) => {
  const { user, t, pubsub } = context
  ensureUserHasRole(user, 'editor')
  const { githubRest } = await createGithubClients()

  const {
    repoId,
    parentId,
    message,
    document: { content: mdast },
    isTemplate,
  } = args

  debug({ repoId, message })

  const [login, repoName] = repoId.split('/')
  const cacheUpsert = {
    id: repoId,
    content: JSON.parse(JSON.stringify(mdast)),
  }

  // get / create repo
  let repo = await getRepo(repoId).catch((response) => null)

  if (isTemplate && !mdast.meta.title) {
    throw new Error(t('api/commit/templateTitle/required'))
  }

  if (isTemplate && !mdast.meta.slug) {
    throw new Error(t('api/commit/templateSlug/required'))
  }

  if (repo) {
    if (!parentId) {
      throw new Error(t('api/commit/parentId/required', { repoId }))
    }
  } else {
    if (parentId) {
      throw new Error(t('api/commit/parentId/notAllowed', { repoId }))
    }

    repo = await githubRest.repos.createInOrg({
      org: login,
      name: repoName,
      private: true,
      auto_init: true,
      is_template: isTemplate,
    })

    Object.assign(cacheUpsert, {
      createdAt: repo.data.created_at,
      isArchived: false,
      isTemplate,
      meta: {},
      name: repoName,
      publications: [],
      tags: { nodes: [] },
    })
  }

  // extract repo images
  const images = []
  const promises = []

  visit(mdast, 'image', async (node) => {
    promises.push(
      (async () => {
        node.url = await importFromRepo(node.url, images, repoId)
      })(),
    )
  })
  if (mdast.meta) {
    promises.push(
      ...Object.keys(mdast.meta).map(async (key) => {
        if (key.match(/image/i)) {
          mdast.meta[key] = await importFromRepo(
            mdast.meta[key],
            images,
            repoId,
          )
        }
      }),
    )

    const series = mdast.meta.series
    if (series && Array.isArray(series.episodes)) {
      series.episodes.forEach((episode) => {
        if (episode.image) {
          promises.push(
            (async () => {
              episode.image = await importFromRepo(
                episode.image,
                images,
                repoId,
              )
            })(),
          )
        }
      })
    }
  }

  // reverse asset url prefixing
  // repo images
  processRepoImageUrlsInContent(mdast, unprefixUrl)
  processRepoImageUrlsInMeta(mdast, unprefixUrl)
  // embeds
  processImageUrlsInContent(mdast, unprefixUrl)

  visit(mdast, 'image', async (node) => {
    promises.push(
      (async () => {
        node.url = await extractImage(node.url, images)
      })(),
    )
  })
  if (mdast.meta) {
    promises.push(
      ...Object.keys(mdast.meta).map(async (key) => {
        if (key.match(/image/i)) {
          mdast.meta[key] = await extractImage(mdast.meta[key], images)
        }
      }),
    )

    const series = mdast.meta.series
    if (series && Array.isArray(series.episodes)) {
      series.episodes.forEach((episode) => {
        if (episode.image) {
          promises.push(
            (async () => {
              episode.image = await extractImage(episode.image, images)
            })(),
          )
        }
      })
    }
  }
  await Promise.all(promises)

  // serialize
  const markdown = MDAST.stringify(mdast)

  // markdown -> blob
  // try this until success
  // CreateBlob sometimes fails even with "Initial commit" present
  // on main. Issue under investigation with github.
  let markdownBlob
  let success = false
  let count = 20
  while (success === false) {
    markdownBlob = await githubRest.git
      .createBlob({
        owner: login,
        repo: repoName,
        content: markdown,
        encoding: 'utf-8',
      })
      .then((result) => result.data)
      .catch((e) => {
        const util = require('util')
        console.log('createBlob failed!', util.inspect(e, { depth: null }))
        markdownBlob = null
      })

    if (markdownBlob) {
      success = true
    } else {
      if (count-- < 0) {
        throw new Error(
          'commit could not create a repo in time. please try again.',
        )
      }
      await sleep(300)
    }
  }

  // images -> blobs
  await Promise.all(
    images.map(({ blob }) => {
      return githubRest.git
        .createBlob({
          owner: login,
          repo: repoName,
          content: blob.toString('base64'),
          encoding: 'base64',
        })
        .then((result) => result.data)
    }),
  )

  let parentCommit
  if (parentId) {
    // otherwise initial commit
    // load base_tree
    parentCommit = await githubRest.git
      .getCommit({
        owner: login,
        repo: repoName,
        commit_sha: parentId,
      })
      .then((result) => result.data)
  }

  const tree = await githubRest.git
    .createTree({
      owner: login,
      repo: repoName,
      ...(parentCommit ? { base_tree: parentCommit.tree.sha } : {}),
      tree: [
        ...images.map(({ path, hash }) => ({
          path,
          sha: hash,
          mode: '100644', // blob (file)
          type: 'blob',
        })),
        {
          path: 'article.md',
          sha: markdownBlob.sha,
          mode: '100644',
          type: 'blob',
        },
      ],
    })
    .then((result) => result.data)

  const commit = await githubRest.git
    .createCommit({
      owner: login,
      repo: repoName,
      message,
      tree: tree.sha,
      parents: parentId ? [parentId] : [],
      author: gitAuthor(user),
    })
    .then((result) => result.data)

  Object.assign(cacheUpsert, { commit })

  await repoCacheUpsert(cacheUpsert, context)

  // load heads
  const heads = await getHeads(repoId, context)

  // check if parent is (still) a head
  // pick main for new repos initated by github
  const headParent = parentId
    ? heads.find((ref) => ref.target.oid === parentId)
    : { name: 'main' }

  let branch
  if (headParent) {
    // fast-forward
    branch = headParent.name
    await githubRest.git.updateRef({
      owner: login,
      repo: repoName,
      ref: 'heads/' + headParent.name,
      sha: commit.sha,
      force: !parentId,
    })
  } else {
    branch = slugify(
      `${superb.random()}-${superheroes.random()}`
        .replace(/\./g, '-')
        .toLowerCase(),
    )
    await githubRest.git.createRef({
      owner: login,
      repo: repoName,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    })
  }

  // latest commit -> default branch
  await githubRest.repos
    .update({
      owner: login,
      repo: repoName,
      name: repoName,
      default_branch: branch,
    })
    .catch((e) => console.error('edit default_branch failed!', e))

  await pubsub.publish('repoUpdate', {
    repoUpdate: {
      id: repoId,
    },
  })

  return commitNormalizer({
    // normalize createCommit format to getCommit (duh gh!)
    sha: commit.sha,
    commit,
    parents: commit.parents,
    //
    repo: {
      id: repoId,
    },
  })
}
