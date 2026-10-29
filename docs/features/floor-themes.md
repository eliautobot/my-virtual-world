# Floor Themes and floor names

A floor of a building can be laid out as a kind of place: an arcade, a lounge, a night club, a café, a restaurant, a
shop, a gym, an open office or a conference floor. The layout is generated to fit the floor's size and its elevator,
like the city's own floors, and can then be furnished further by hand. Any floor can also be given its own name, shown
wherever the floor is named.

Asked for by the product owner on 2026-10-22 ("Floor Themes ... floor templates, like an arcade, procedurally generated
like other floors"), with the floor names on hover; built 2026-10-23.

## Using it

In the Furnish panel, the floor bar (above the categories) has two buttons next to Clear floor and Regenerate:

- **🎨 Floor Themes** opens the list of themes. A tap on one asks to confirm (it replaces the floor); the second tap lays
  the floor out. One edit: ↶ undo brings the floor back. With "Same on all floors with this layout" ticked, every floor
  sharing the layout changes together.
- **✏️ Name** gives the floor its own name (up to 40 characters). Taking the name off brings back the name it was laid
  out with.

A themed floor keeps its theme: 🎲 Regenerate rolls the same theme again, a resize of the building lays it out again for
the new size, and ↺ Reset to auto gives the building's own floor back. 💾 Save layout keeps a themed floor like any
other, to lay out on other floors of the same kind.

The floor's name shows on the floor buttons of the building's card (when hovered), in the tip when the pointer is over a
floor from outside, on the tag where a floor was picked, and under the floor number on the floor control inside.

## The themes

| Theme | What is in it | For the city |
| --- | --- | --- |
| Arcade | Laid out in zones fitted to the floor (see [The arcade](#the-arcade)): a neon ARCADE over cabinets on the back wall, mini bowling lanes along one side on a big floor, a prize corner and a snack corner at the front, a lounge in a back corner, and across the middle strips of attractions (billiards, a mechanical bull, air hockey, skee-ball, hoops, a dance machine, racers, claw machines, pinball, whack-a-mole, a punching machine, foosball, a photo booth, a giant joystick) by turns with strips of cabinets; claw machines along the front wall; LED pillars and floor light strips; a neon arcade carpet | a lounge: the people who work in the building hang out there |
| Lounge | Modern organic, elegant and softly lit (see [The lounge](#the-lounge)): an island bar (or a round one) in the middle of the room, a salon behind panelled walls with a fireplace on a big floor, a little stage with supper-club tables, banquettes, booths, sofas, loveseats, club chairs, tables for two and four, high tables, groups fanned round the bar with walkways between | a lounge |
| Night Club | Miami style (see [The night club](#the-night-club)): the DJ's round stage in the middle of an LED dance floor ring, speakers, light towers, lasers, a long backlit onyx bar, an LED video wall, VIP booths behind velvet ropes, party tables, lounges, high tables, royal palms, black marble | a lounge |
| Café | The city's café layout | a café: a business residents come to |
| Restaurant | The city's restaurant layout | a restaurant: a business |
| Shop | The city's shop layout | a shop: a business |
| Gym | The city's gym layout | a gym: a business |
| Open Office | The city's office layout (fancy) | none |
| Conference | Meeting rooms behind glass along the back, a boardroom in the middle where the floor is deep enough, a reception with a waiting corner, a coffee point | none |

Every cabinet on an arcade floor plays like any other ([arcade](arcade.md)): its screens and marquees are drawn
together, two instanced meshes a game, however many cabinets the floor has.

## The arcade

The arcade has its own furniture (the Furnish panel's **Arcade** tab), each piece placeable by hand too:

| Kind | Pieces |
| --- | --- |
| Games | Arcade Cabinet (plays our games), Billiards Table, Mini Bowling Lane, Mechanical Bull, Air Hockey, Claw Machine, Skee-Ball, Basketball Hoops, Pinball Machine, Racing Cabinet (sit-down), Dance Machine, Whack-a-Mole, Punching Machine, Foosball Table, Photo Booth |
| Prizes and food | Prize Case, Prize Wall (shelves of plush toys), Token Machine, Snack Bar (popcorn machine, soda fountain, a lit menu) |
| Seats | Neon Booth, High-Top Table (with three bar stools), Gaming Chair |
| Lights and walls | Neon signs (ARCADE, GAME ON, PRIZES, SNACKS, a joystick, a space drone), Pixel Murals (space, maze), LED Pillar (slowly through the colours), Floor Light Strip (glows in its colour), Giant Joystick |

Residents play the games (the dance machine is danced on), sit in the booths and at the tables, look at the prizes and
buy snacks. Only the cabinets play our own games for now; the other games are for residents and for the look.

The layout follows the floor: cabinets about one to 5 m² (24 to 150), the middle's strips alternating big attractions,
cabinets and smaller attractions with 1.6 m aisles, smaller attractions at the ends of a strip and in what is left before
the front, so the floor is full but never crowded (about a fifth to a third of the floor under pieces; a street floor
keeps its way in). The way in from the door and the way out of the elevator stay clear, the prize counter keeps room for
its clerk and its customers, the snack bar for its customers.

New light effects for the pieces (render/mats.js): marquee bulbs that run (chase) and colours that slowly cycle.

## The lounge

The lounge has its own furniture (in the Furnish panel's **Lounge** tab with the other lounge pieces), each piece
placeable by hand too:

| Kind | Pieces |
| --- | --- |
| Bars | Island Bar (a racetrack of marble on a lacquered, brass-fluted front, 24 stools all round, a bartender's well, a tower of lit shelves and bottles, a brass halo of hanging globes above), Round Bar (the same, round, 14 stools), Terrazzo Bar with its Back Bar, Drink Ledge (three stools), High Table (three stools) |
| Tables | Table for Two, Table for Four (marble on brass with a candle, velvet dining chairs), Banquette & Tables (a channel-tufted bench, two tables, two chairs), Round Booth |
| Sofas and chairs | Tufted Sofa, Loveseat, Curved Sofa, Serpentine Sofa, Club Chair, Bouclé Chair, Shell Chair, Round Pouf, Chaise Longue |
| Low tables and rugs | Stone Coffee Table, Side Table & Lamp, Fire Table (flames behind glass), Organic Rug (a deeper border and a carved ring) |
| Light | Arc Floor Lamp, Floor Lantern (paper, glows after dark), Wall Sconce, Warm Light Strip, Lit Wall Niche |
| The salon | Fireplace (low travertine, a linear fire behind glass, vases on its walnut top), Bookcase (lit shelves of books, vases and brass) |
| Sculpture and plants | Twisted Sculpture (a bronze ribbon), Stone Sculpture, Ring Sculpture, Ceramic Vases, Olive Tree, Planter (a palm), Planter Divider |
| Walls and screens | Wood Slat Wall, Slatted Screen, Abstract Art |
| The stage | Lounge Stage: a curved walnut platform with a warm edge light, a velvet curtain, three spotlights whose beams show after dark, a grand piano, a double bass, a microphone and monitors |

The bars' stools are seats for residents (drinks); their bartender places are counters, so the ⋯ menu puts one of your
agents behind the bar. The stage's three places (the piano, the microphone, the double bass) have the use `music`:
residents play there now, and agents can take them when they play music and instruments one day.

The layout is a place, not a grid:

- **The salon**: on a big floor (about 25 m by 13 m and up) one end is walled off with panelled walnut walls (fluted, a
  brass cap, a warm light at the foot; wall kind 2) with one or two wide openings: a fireplace with a sofa and club chairs
  round it on a rug, bookcases, loveseats face to face, chaises, tables. Olive trees and palms stand at the openings.
- **The bar** is the centrepiece: an island bar on a big hall (20 m and up), a round bar on a middling one, on a marble
  floor with high tables round it beyond its aisle; on a small floor the terrazzo bar on the back wall with a drink
  ledge. A lounge always has a bar; the stage gives way to it on the smallest floors.
- **The stage** stands on the hall's back wall toward one end (a side wall when the back is taken), slatted screens either
  side, tables for two and four in arcs before it like a supper club.
- **The walls**: runs of banquettes with their tables, lounge corners (a sofa against the wall, club chairs facing it
  across a coffee table on a rug), round booths, olive trees, art with sconces, lit niches; on the salon's walls only
  seats and plants (in the cutaway the walls are cut down).
- **Aisles** run from the way in (or the elevator), the stage and the salon's openings to the bar.
- **The rest**: groups set where the room opens out, the widest free spot first, each turned toward the bar, the stage
  or the fire in eighths of a half turn, so they fan round the room: a tufted sofa with club chairs, loveseats face to
  face, the curved sofa, a fire table ringed with chairs, chaises, booths, tables for four and two, club chairs in pairs;
  each keeps a walkway from the pieces already there and goes down whole or not at all, until a bit under a third of the
  floor is furnished.

Glows round the lamps, lanterns and globes and the stage's beams show only after dark (render/mats.js: a glow seen at
night only); rugs and light strips are drawn over the floor's finish from any distance.

## The night club

The club has its own furniture (the Furnish panel's **Club** tab):

| Kind | Pieces |
| --- | --- |
| The DJ | DJ Stage: a round white stage with an LED band, the DJ's curved booth lit through the colours, two decks and a mixer, a truss ring overhead with eight moving lights, a mirror ball and two lasers |
| Dance floors | LED Dance Floor (a raised ring round the stage, 11.8 m across, tiles in deep cycling colours and pulsing ones), LED Dance Floor (small, 8.8 m) |
| Bar and seats | Club Bar (6.8 m: a backlit onyx front, black marble and gold, eight stools, a mirrored back bar of lit bottles, a pink neon line), VIP Booth (a deep curved diamond-tufted booth for six round a marble table with champagne, a lit bottle and sparklers), Party Table (eight chairs, champagne, candles) |
| Sound and light | Speaker Stack (a sub and a line array), Light Tower (a truss with two moving lights and a strobe), Laser Bar (on a wall), LED Video Wall, Go-Go Podium |
| Decor | Neon Palm over MIAMI, Neon VIP, Royal Palm, Velvet Rope |

The DJ's place on the stage is a post (the ⋯ menu puts one of your agents on the decks); residents dance on the floor,
on the stage and on the podiums. The lounge's seats (sofas, loveseats, tables, high tables) come in the club's colours.

The layout: the DJ's stage stands in the middle of the floor on its LED ring (the small ring on a middling floor; on a
small floor the stage against a wall with a square dance floor before it), speaker stacks at the ring's corners, light
towers at its sides, go-go podiums at its edge, high tables round it. The bar goes on the back wall's widest stretch
clear of the elevator, the LED wall on another stretch. VIP booths line the side walls, each on velvet carpet between
velvet ropes under neon (VIP, or a palm over MIAMI). Party tables, white sofas, loveseats and tables fill where the room
opens out, turned to the dance floor. Lasers on the side walls, royal palms in the corners and at the way in. Aisles run
from the way in, the elevator and the bar to the dance floor. The beams, lasers and glows show after dark; the LED
floors and wall cycle through deep colours that stay colours at night (render/mats.js light 8).

## Rules

- Floors with flats keep their flats (an apartment building's floors above the street). Parks and the airport have no
  floor themes.
- Theming a floor takes build rights on its lot (like Regenerate); naming it takes furnishing rights.
- A floor let as a business for Virtual Coin can't be re-themed or renamed while the lease runs
  (server/economy/realty.js).

## Where it lives

| Part | Files |
| --- | --- |
| The list of themes, who may have one, the name's length | `shared/floor-themes.js` |
| The layouts | `server/world/layouts.js` (`arcadeFloor`, `loungeThemeFloor`, `clubThemeFloor`, `conferenceFloor`, `themeFloor`, `fillGroups`; `buildLevel` with `o.theme`) |
| A level's theme and roll | `server/world/generate.js` `freshLevel(b, f, roll, theme)` sets `theme`; a re-roll and a resize pass it on |
| The edits | `server/world/edit.js` ops `lvl.theme` and `lvl.name` (`levelOp`, `levelName`); rights in `server/lot-rights.js` |
| The arcade carpet | `shared/catalog.js` `FINISHES.carpet_arcade` (pattern 7), `client/js/render/mats.js` |
| The arcade's furniture | `shared/catalog.js` (category Arcade), `client/js/render/furniture-arcade.js` (the models), `client/js/render/mats.js` (chase and cycle light), `client/js/core/icons.js` (their icons) |
| The club's furniture | `shared/catalog.js` (category Club), `client/js/render/furniture-club.js` (the models), `client/js/render/mats.js` (light 8, a soft colour cycle) |
| The lounge's furniture | `shared/catalog.js` (the Lounge blocks before the arcade's), `shared/bar-shape.js` (the island bars' shape, stools and bartenders), `client/js/render/furniture-lounge.js` (the models), `client/js/render/mats.js` (glow after dark), `client/js/render/interiors.js` (rugs drawn over the floor; the panelled walls) |
| The interface | `client/js/ui/floor-themes.js` (the dialogs), `client/js/ui/editors.js` (the floor bar), `client/js/ui/ui.js` (names on the buttons, tip, tag, control), `client/css/floor-themes.css` |

## Checks

- `tests/floor-themes.test.mjs`: every theme on every kind of building at several sizes (inside the walls, nothing
  overlapping, the way in clear, the arcade's cabinets within their cap, its carpet and prize counter, the lounge's stage,
  seats, rugs and lamps, how much of it is furnished); over HTTP an
  arcade, undo, names through a re-roll, a resize, reset, and the refusals.
- Lab `tools-bin/floor-themes-check.mjs` (desktop and phone): the floor bar, the dialog, an arcade laid out, its
  cabinets' screens drawn together and playable, the name on the floor control and buttons, no page errors, the frame
  rate looking into the arcade. `THEME=lounge ZOOMS=1 FOCUS=lounge_stage,lounge_bar` takes close looks by day and night
  (use `MVW_TEST_ANGLE=vulkan` for the real graphics card).

## The café (redone 2026-10-26)

`server/world/layouts.js` `cafeThemeFloor`, used for the Café theme and the city's own cafés: five styles
(`shared/floor-themes.js` `CAFE_STYLES`: bistro, nordic, loft, library, garden), each a kit of counter, floors, seats,
wall pieces and features (`client/js/render/furniture-cafe.js`, catalog category Café). One plan for any floor: the
style's counter on the back wall (searched along it, else the shorter Café Counter, else a side wall: always an order
point), its pastry case, condiment bar and menu boards, the queue kept clear; the open kitchen beside it (worktops on
tile: the Order Up stations come there, PLAN-RESTAURANT-GAME.md); the style's corner (the roaster, a reading nook by the
hearth); a centrepiece on a big floor (a communal table, a fountain); its walls (booths, books, shelving, palms);
seats along the front windows from the door outward; a lounge corner on a big floor; tables in the style's mix with
planters between them; its lights or ivy over the tables. The style is the floor's (`style`), chosen with
`lvl.theme { theme: 'cafe', style }` or by the dice, and kept by 🎲 Regenerate and a resize. Lab: tools-bin/cafe-check.mjs.
