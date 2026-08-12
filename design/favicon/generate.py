#!/usr/bin/env python3
"""Generate the truman icon: an ascii-shaded eye on a black disc.

A sibling to the donut on justin06lee.dev and chrome.justin06lee.dev, the cup
on coffee.justin06lee.dev, the hourglass on hours.justin06lee.dev, the record
on listen.justin06lee.dev and the hex nut on oddjob.justin06lee.dev — same
pipeline, same ramp, same disc. A real form is raymarched, lit, sampled onto a
character grid, and each cell is drawn as the rect skeleton of the glyph its
luminance lands on.

Glyphs are rects rather than <text>, for the reason coffee gives: a favicon is
rendered where font availability isn't guaranteed, and a missing monospace
face would leave an empty disc. Rect geometry always draws.

The object is an eye because the site is the audience: the one thing every
visitor does here is watch. The tab is where they keep watching from.

WHAT THIS ONE DOES DIFFERENTLY

An eyeball is a sphere, and a sphere is the one form pitch cannot open up.
The record had the same disc-in-a-disc problem and rolled its camera; here no
camera move helps, because every orientation of a sphere has the same outline.
The lids do it instead: two larger spheres intersected with the eyeball CSG
away its top and bottom, and the silhouette stops being a circle and becomes
an almond — which is the one contour that says "eye" before any interior
detail loads. They are cuts rather than drawn-on shading so the outline
itself changes, which is what survives 16px.

The gaze is off-axis on purpose. Face-on, an iris is a centred disc inside a
brighter disc — a donut with better PR, and the family already has two tori.
Aimed up and to the left, the iris lands as an off-centre ellipse and the
mark reads as an eye *looking* somewhere, which is uncomfortably alive in a
tab bar, and that discomfort is the site's whole premise.

Three zones on the ball, plus the lids:

  SCLERA is bright, and honestly so — this is the family's one form whose
  real-world material actually is white. Where the vinyl and the glass had to
  lie to keep ink on the disc, the eye white just is the ink.

  IRIS carries the texture: a collar that brightens toward the pupil and two
  soft rings, listen's groove trick bent around a different axis. A thin
  limbal ring at its outer edge is clamped dark, because iris-against-sclera
  is the boundary that makes an eye read as an eye at any size.

  PUPIL is forced near-black and gets no rim, oddjob's bore argument verbatim:
  the hole only reads if it is the darkest thing in the mark, and at 16px the
  whole eye averages down to a bright almond with one dark offset dot — which
  is exactly the mark.

  LIDS shade low and quiet. They exist to shape the silhouette, not to be
  looked at; bright lids would close the eye from either side.

THE GLINT is the family's only specular highlight: one hard reflection pinned
where the light mirrors off the cornea, allowed to override even the pupil's
clamp. A dry eye is a dead eye — every cartoonist knows the glint is the
difference between an eye and a diagram of one. It is a single cell or two
and vanishes by 16px, and it is kept anyway, for the same reason listen keeps
its tonearm: it costs nothing where it is invisible and carries the mark at
the size it is actually designed at.

TUNING is for 16px, not for the 136px artboard, exactly as coffee argues: at
a tab's real size a 30x30 grid averages to well under one cell per pixel, so
only the silhouette and the coarse light-to-dark structure survive.

    python3 design/favicon/generate.py > app/icon.svg
    python3 design/favicon/generate.py --preview
"""
import argparse
import math
import sys

N = 30                  # cells across
VIEW = 136.0            # viewBox units
CELL = VIEW / N
DISC = 0.97             # black disc radius, normalised
LEVELS = 11             # 1..11; 0 is empty, mirroring the ramp's leading space
# World units across the disc radius; lower zooms in. The almond is the widest
# low form in the family, so it gets more room than the round marks — tuned by
# eye against the record and the nut so all three carry the same weight.
SCALE = 0.90

EYE_R = 0.80            # the ball
# The lids. A first pass centred the cutting spheres on the y axis, which cuts
# a sphere along a latitude circle — flat lines face-on, a letterbox with
# round ends, not an eye. Bowing the cutting sphere toward the camera tilts
# its cut circle, and the circle is *solved* to pass through the two corner
# points and the front apex: the projected lid edges then curve from corner to
# apex and the silhouette is a true pointed almond. LID_H is the opening's
# half-height at the front; LID_BOW is how far the cut centre sits toward the
# camera — more bow flattens the arc toward a rhombus, less rounds it.
LID_H = 0.45
LID_BOW = 0.55
_zh = math.sqrt(EYE_R ** 2 - LID_H ** 2)      # apex depth on the ball
_cz = -LID_BOW
_cy = (_zh / LID_H) * _cz                     # below the axis, from the
                                              # equal-distance condition
LID_R = math.sqrt(EYE_R ** 2 + _cy ** 2 + _cz ** 2)
TOP_CUT = (0.0, _cy, _cz)                     # centre sits low: cuts the top
BOTTOM_CUT = (0.0, -_cy, _cz)                 # and its mirror cuts the bottom

# Where the eye looks: toward the camera, up and to the left. The iris zones
# are measured as angles from this axis on the ball's surface.
GAZE = (-0.40, 0.20, -1.0)
PUPIL_COS = math.cos(math.radians(13.5))
LIMBAL_IN = math.cos(math.radians(29.5))   # iris proper ends here...
LIMBAL_OUT = math.cos(math.radians(33.0))  # ...and the dark limbal ring here

# Rolls the almond a few degrees in screen space. Dead level it reads as a
# diagram; slightly tipped it reads as a face's eye, which is the point.
ROLL = math.radians(-6)

# The family's light, off-axis on all three so the ball actually turns.
LIGHT = (-0.62, 0.66, -0.42)

# Strong and tight: on this mark the silhouette IS the drawing. The almond's
# corners taper through grazing cells that plain lambert leaves mushy — the
# rim is what prints them, the same job it does for oddjob's hex corners.
RIM = 0.62
RIM_FALLOFF = 2.6

# The glint: a hard phong lobe, and a floor it must clear to print. At 80 the
# lobe is one or two cells wide on this grid, which is a glint and not a shine.
GLINT_POWER = 80
GLINT_FLOOR = 0.45

RAMP = " ,-~:;=!*#$@"   # for --preview only; the SVG draws rects, not glyphs


def norm(v):
    m = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / m, v[1] / m, v[2] / m)


LIGHT = norm(LIGHT)
GAZE = norm(GAZE)

# Surface ids, so each zone can shade by its own rules.
SCLERA, IRIS, LIMBAL, PUPIL, LID = 0, 1, 2, 3, 4


def sd_sphere(p, center, r):
    return math.dist(p, center) - r


def scene(p):
    """Signed distance to the lidded eye, and which surface was nearest."""
    ball = sd_sphere(p, (0.0, 0.0, 0.0), EYE_R)
    upper = sd_sphere(p, TOP_CUT, LID_R)
    lower = sd_sphere(p, BOTTOM_CUT, LID_R)

    d = max(ball, upper, lower)
    if d == ball:
        # On the ball itself: zone by angle from the gaze axis.
        c = sum(a * b for a, b in zip(norm(p), GAZE))
        if c > PUPIL_COS:
            return d, PUPIL
        if c > LIMBAL_IN:
            return d, IRIS
        if c > LIMBAL_OUT:
            return d, LIMBAL
        return d, SCLERA
    return d, LID


def normal_at(p):
    e = 0.0015
    dx = scene((p[0] + e, p[1], p[2]))[0] - scene((p[0] - e, p[1], p[2]))[0]
    dy = scene((p[0], p[1] + e, p[2]))[0] - scene((p[0], p[1] - e, p[2]))[0]
    dz = scene((p[0], p[1], p[2] + e))[0] - scene((p[0], p[1], p[2] - e))[0]
    return norm((dx, dy, dz))


def trace(u, v):
    """Luminance in 0..1 for a ray through screen point (u, v), 0 for a miss."""
    origin = (u, v, -3.0)
    direction = (0.0, 0.0, 1.0)

    t = 0.0
    for _ in range(96):
        p = (origin[0], origin[1], origin[2] + t)
        d, surface = scene(p)
        if d < 0.002:
            n = normal_at(p)
            lambert = max(0.0, sum(n[i] * LIGHT[i] for i in range(3)))

            # The glint first, because it is allowed to beat everything —
            # including the pupil's clamp. One mirror bounce against the light.
            dot_dn = sum(direction[i] * n[i] for i in range(3))
            refl = tuple(direction[i] - 2.0 * dot_dn * n[i] for i in range(3))
            spec = max(0.0, sum(refl[i] * LIGHT[i] for i in range(3))) ** GLINT_POWER
            if spec > GLINT_FLOOR:
                return 0.97

            if surface == PUPIL:
                return 0.05
            if surface == LIMBAL:
                return 0.10 + 0.06 * lambert
            if surface == IRIS:
                # 0 at the limbal edge, 1 at the pupil: a collar that brightens
                # toward the centre, with two soft rings — listen's grooves
                # bent around the gaze axis instead of the spindle.
                c = sum(a * b for a, b in zip(norm(p), GAZE))
                span = (c - LIMBAL_IN) / (PUPIL_COS - LIMBAL_IN)
                rings = 0.05 * math.sin(span * math.tau * 1.8)
                return 0.16 + 0.16 * lambert + 0.16 * span + rings
            if surface == LID:
                # The lids are the cut, not the subject. They print nothing:
                # an early pass shaded them faintly and they filled the disc
                # with grey, closing the eye from both sides. The silhouette
                # they leave behind IS their contribution.
                return 0.0
            # Sclera: bright, honestly — and with a high floor, because an eye
            # white is diffuse. Shaded like the family's metal and ceramic it
            # turned into a ball with a hot corner; a real white stays white
            # all the way round and lets the iris carry the contrast.
            facing = abs(dot_dn)
            rim = RIM * (1.0 - min(1.0, facing)) ** RIM_FALLOFF
            # A flat-ish interior under a bright edge: the white stays white,
            # the outline stays the brightest path, and the busy-ness lives
            # in the iris where it belongs.
            return min(1.0, 0.55 + 0.30 * lambert + rim)
        if t > 6.0:
            break
        t += max(d * 0.85, 0.004)
    return 0.0


def glyph(level, cx, cy):
    """Rects for one cell, shaped to evoke the ascii ramp it stands in for.

    Shared verbatim with coffee, hours and oddjob — the ramp is the family's,
    not this mark's, and a different glyph skeleton here would make the icons
    siblings in subject only.
    """
    s = CELL
    unit = s / 5.0
    px, py = cx - s / 2.0, cy - s / 2.0

    def rect(gx, gy, gw, gh):
        # Emitted as path data rather than a <rect> element: the icon is a few
        # hundred marks, and "M.. h.. v.. h.. z" is less than half the bytes of
        # the equivalent element once they are all concatenated into one path.
        return (f"M{px + gx * unit:.1f} {py + gy * unit:.1f}"
                f"h{gw * unit:.1f}v{gh * unit:.1f}h{-gw * unit:.1f}z")

    if level <= 1:                      # ,
        return [rect(2, 3, 1.1, 1.1)]
    if level <= 3:                      # - ~
        return [rect(1, 2.1, 3, 1)]
    if level <= 5:                      # : ;
        return [rect(2, 0.6, 1.1, 1.3), rect(2, 3.2, 1.1, 1.3)]
    if level <= 7:                      # = !
        return [rect(0.6, 1.1, 3.8, 1), rect(0.6, 3.0, 3.8, 1)]
    if level <= 9:                      # * #
        return [rect(0.5, 1.1, 4, 0.9), rect(0.5, 3.1, 4, 0.9),
                rect(1.4, 0.3, 0.9, 4.4), rect(2.8, 0.3, 0.9, 4.4)]
    return [rect(0.35, 0.35, 4.3, 4.3)]  # $ @


def levels_grid():
    """Trace the whole grid once, returning a list of rows of levels."""
    cr, sr = math.cos(ROLL), math.sin(ROLL)
    rows = []
    for row in range(N):
        line = []
        for col in range(N):
            cx, cy = (col + 0.5) * CELL, (row + 0.5) * CELL
            u = (cx - VIEW / 2) / (VIEW / 2) * SCALE
            v = -(cy - VIEW / 2) / (VIEW / 2) * SCALE
            if math.hypot(u / SCALE, v / SCALE) > DISC - 0.02:
                line.append(0)
                continue
            # Roll in screen space: the whole scene tips, lids and gaze with it.
            ru = u * cr - v * sr
            rv = u * sr + v * cr
            line.append(int(round(trace(ru, rv) * LEVELS)))
        rows.append(line)
    return rows


def opacity_for(level):
    # The floor is low on purpose: the faintest glyphs have to actually
    # recede, or every cell contributes ink and the disc fills in.
    return 0.13 + 0.87 * (level / LEVELS)


def build():
    grid = levels_grid()

    buckets = {}
    for row in range(N):
        for col in range(N):
            level = grid[row][col]
            if level <= 0:
                continue
            cx, cy = (col + 0.5) * CELL, (row + 0.5) * CELL
            buckets.setdefault(level, []).extend(glyph(level, cx, cy))

    levels = sorted(buckets)

    # One class per level rather than a fill-opacity attribute per path, so the
    # stylesheet can restyle the whole mark from one rule. It is also fewer
    # bytes: the opacity is stated once instead of on every path.
    rules = ["path{fill:#fff}"]
    rules += [f".l{level}{{fill-opacity:{opacity_for(level):.2f}}}"
              for level in levels]

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW:.0f} {VIEW:.0f}"'
        f' width="{VIEW:.0f}" height="{VIEW:.0f}">',
        "<title>truman</title>",
        "<style>" + "".join(rules) + "</style>",
        # The disc is load-bearing, not decoration: the eye is white ink only,
        # so it needs a ground to sit on wherever a browser paints the tab. It
        # is baked in rather than left to a media query, because this same file
        # is rasterised to the ICO and the Apple icon, and neither format can
        # carry one.
        f'<circle cx="{VIEW / 2:.0f}" cy="{VIEW / 2:.0f}"'
        f' r="{DISC * VIEW / 2:.2f}" fill="#000000"/>',
    ]
    out += [f'<path class="l{level}" d="{"".join(buckets[level])}"/>'
            for level in levels]
    out.append("</svg>")
    return "\n".join(out) + "\n"


def preview():
    """The mark as characters, for judging it without rasterising anything."""
    lines = []
    for row in levels_grid():
        lines.append("".join(RAMP[min(level, len(RAMP) - 1)] for level in row))
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true",
                        help="print the character grid instead of the svg.")
    args = parser.parse_args()
    sys.stdout.write(preview() if args.preview else build())


if __name__ == "__main__":
    main()
