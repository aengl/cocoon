# Cocoon2

A visual data processing and automation platform.

<!-- TOC depthFrom:2 -->

- [Setup](#setup)
- [Usage](#usage)

<!-- /TOC -->

## Setup

1.  First off, make sure to install a recent version of `Node.js` (>=10):

    ```
    brew install nodejs
    ```

1.  Create an RSA key for github:

    - `ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_github_rsa`
    - `cat ~/.ssh/id_github_rsa.pub | pbcopy`
    - `open https://github.com/settings/keys`
    - Click the button `New SSH key`
    - Title it `id_github_rsa`, paste the key with <kbd>⌘</kbd> <kbd>V</kbd>

1.  Associate the RSA key with `github.com` by pasting the following into your `~/.ssh/config`:

    ```
    Host github.com
      IdentityFile ~/.ssh/id_github_rsa
    ```

1.  Install Cocoon:

    ```
    npm install -g git+ssh://git@github.com/camyyssa/cocoon2.git#master
    ```

1.  Updating Cocoon:

    ```
    cocoon update
    ```

## Usage

Run the CLI via `cocoon` and the editor via `cocoon-editor`.
