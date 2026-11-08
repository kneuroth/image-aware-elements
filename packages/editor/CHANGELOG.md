# @image-aware/editor

## 0.1.2

### Patch Changes

- 99b2cd0: `--open` no longer crashes the editor when there's no browser opener to run.
  On WSL, a bare Linux box or a container, `xdg-open` is missing, and the
  unhandled spawn error took the whole server down with it. Now the editor says
  it couldn't open a browser, prints the URL to go to, and keeps serving.
  - @image-aware/core@0.1.2
  - @image-aware/element@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [d435e48]
  - @image-aware/element@0.1.1
  - @image-aware/core@0.1.1
