---
'@image-aware/element': patch
---

A floated surface no longer clips its content.

`clip` on a surface means "keep this inside the object it was marked onto", and it was
being applied to every placement — including `{ rect }` floats, where the content has
left the object and is sitting in a box the art direction chose. A `flow` placement
already reset it; `float` did not.

The visible cost was that anything a floated card painted outside its own bounds was
silently eaten: drop shadows, glows, focus rings — exactly what content reaches for once
it is floating on open photograph instead of sitting on a laptop screen.

Clipping while projected is unchanged. A page that wants a floated box to clip can set
`overflow: hidden` on its own slotted element; nothing outside the shadow root could
remove a clip imposed inside it, so unclipped is the only default that leaves both
options open.
