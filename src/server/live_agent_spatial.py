"""Pure spatial-relation helpers for Live Agent perception.

The realtime sidecar owns body coordinates.  This module turns those
coordinates into deterministic distance, place, and field-of-view facts.  It
does not read files or mutate world state, which keeps the geometry easy to
stress test independently from the HTTP server.
"""

import math


SPATIAL_SCHEMA_VERSION = "agent-live-mode-spatial-perception/v1"
API_TILE_UNITS = 40.0
DEFAULT_AWARENESS_RADIUS_TILES = 20.0
DEFAULT_VISUAL_RADIUS_TILES = 12.0
DEFAULT_INTERACTION_RADIUS_TILES = 8.0
DEFAULT_CLOSE_AWARENESS_RADIUS_TILES = 1.5
DEFAULT_FIELD_OF_VIEW_DEGREES = 120.0


def finite_number(value, fallback=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def normalize_floor(value, fallback=1):
    number = finite_number(value, fallback)
    return max(1, int(round(number)))


def normalize_angle_radians(value, fallback=0.0):
    angle = finite_number(value, fallback)
    return math.atan2(math.sin(angle), math.cos(angle))


def angular_delta_radians(target, origin):
    return normalize_angle_radians(normalize_angle_radians(target) - normalize_angle_radians(origin))


def normalize_position(raw):
    if not isinstance(raw, dict):
        return None
    x = finite_number(raw.get("x"))
    y = finite_number(raw.get("y") if raw.get("y") is not None else raw.get("z"))
    if x is None or y is None:
        return None
    return {
        "x": round(x, 3),
        "y": round(y, 3),
        "floor": normalize_floor(raw.get("floor"), 1),
        "buildingId": str(raw.get("buildingId") or "").strip(),
        "roomId": str(raw.get("roomId") or "").strip(),
        "heading": round(normalize_angle_radians(raw.get("heading"), 0.0), 6),
    }


def place_relation(origin, target):
    origin = normalize_position(origin)
    target = normalize_position(target)
    if not origin or not target:
        return {
            "sameFloor": False,
            "sameBuilding": False,
            "sameRoom": False,
            "placeCompatible": False,
            "occludedBy": "position-unavailable",
        }

    same_floor = origin["floor"] == target["floor"]
    origin_building = origin["buildingId"]
    target_building = target["buildingId"]
    same_building = origin_building == target_building
    both_outdoors = not origin_building and not target_building
    origin_room = origin["roomId"]
    target_room = target["roomId"]
    same_room = bool(same_building and origin_room and target_room and origin_room == target_room)
    room_compatible = same_building and (not origin_room or not target_room or same_room)
    place_compatible = bool(same_floor and room_compatible)

    if not same_floor:
        occluded_by = "floor-boundary"
    elif not same_building:
        occluded_by = "inside-outside-boundary" if bool(origin_building) != bool(target_building) else "building-boundary"
    elif origin_room and target_room and not same_room:
        occluded_by = "room-boundary"
    else:
        occluded_by = None

    return {
        "sameFloor": same_floor,
        "sameBuilding": same_building,
        "sameRoom": same_room,
        "bothOutdoors": both_outdoors,
        "roomCompatible": room_compatible,
        "placeCompatible": place_compatible,
        "occludedBy": occluded_by,
    }


def spatial_relation(
    origin,
    target,
    *,
    line_of_sight=True,
    awareness_radius_tiles=DEFAULT_AWARENESS_RADIUS_TILES,
    visual_radius_tiles=DEFAULT_VISUAL_RADIUS_TILES,
    interaction_radius_tiles=DEFAULT_INTERACTION_RADIUS_TILES,
    close_awareness_radius_tiles=DEFAULT_CLOSE_AWARENESS_RADIUS_TILES,
    field_of_view_degrees=DEFAULT_FIELD_OF_VIEW_DEGREES,
):
    """Return deterministic spatial facts for one origin/target pair.

    Realtime heading uses radians with 0 facing +Y and positive values turning
    toward +X, so bearing uses atan2(dx, dy), matching the runtime router.
    Close awareness is intentionally omnidirectional.  It prevents a hard
    visual cone from hiding a person/object that is effectively touching the
    resident while retaining a useful forward-attention signal at range.
    """

    origin = normalize_position(origin)
    target = normalize_position(target)
    place = place_relation(origin, target)
    if not origin or not target:
        return {
            **place,
            "distance": None,
            "distanceTiles": None,
            "bearingRad": None,
            "bearingDegrees": None,
            "relativeBearingDegrees": None,
            "proximityBand": "unknown",
            "withinAwareness": False,
            "withinVisualRange": False,
            "withinInteractionRange": False,
            "perceived": False,
            "inFieldOfView": False,
            "lineOfSight": False,
            "visible": False,
            "interactionReady": False,
        }

    dx = target["x"] - origin["x"]
    dy = target["y"] - origin["y"]
    distance = math.hypot(dx, dy)
    distance_tiles = distance / API_TILE_UNITS
    bearing = normalize_angle_radians(math.atan2(dx, dy), 0.0) if distance > 1e-9 else origin["heading"]
    relative = angular_delta_radians(bearing, origin["heading"])
    close_awareness = distance_tiles <= max(0.0, float(close_awareness_radius_tiles))
    in_forward_cone = abs(math.degrees(relative)) <= max(1.0, float(field_of_view_degrees)) / 2.0
    within_awareness = distance_tiles <= max(0.0, float(awareness_radius_tiles))
    within_visual = distance_tiles <= max(0.0, float(visual_radius_tiles))
    within_interaction = distance_tiles <= max(0.0, float(interaction_radius_tiles))
    in_field_of_view = bool(within_visual and in_forward_cone)
    line_of_sight = bool(line_of_sight and place["placeCompatible"])
    visible = bool(in_field_of_view and line_of_sight)
    perceived = bool(line_of_sight and within_awareness and (visible or close_awareness))
    interaction_ready = bool(within_interaction and line_of_sight and (visible or close_awareness))

    if distance_tiles <= 1.5:
        proximity_band = "immediate"
    elif within_interaction:
        proximity_band = "interaction"
    elif within_visual:
        proximity_band = "visual"
    elif within_awareness:
        proximity_band = "awareness"
    else:
        proximity_band = "distant"

    occluded_by = place.get("occludedBy")
    if place["placeCompatible"] and not line_of_sight:
        occluded_by = "interior-wall"
    elif place["placeCompatible"] and within_visual and not in_field_of_view:
        occluded_by = "outside-field-of-view"
    elif place["placeCompatible"] and not within_visual:
        occluded_by = "outside-visual-range"

    return {
        **place,
        "distance": round(distance, 2),
        "distanceTiles": round(distance_tiles, 3),
        "bearingRad": round(bearing, 6),
        "bearingDegrees": round(math.degrees(bearing), 2),
        "relativeBearingDegrees": round(math.degrees(relative), 2),
        "proximityBand": proximity_band,
        "withinAwareness": within_awareness,
        "withinVisualRange": within_visual,
        "withinInteractionRange": within_interaction,
        "closeAwareness": close_awareness,
        "perceived": perceived,
        "inFieldOfView": in_field_of_view,
        "lineOfSight": line_of_sight,
        "visible": visible,
        "interactionReady": interaction_ready,
        "occludedBy": None if visible else occluded_by,
    }


def point_to_segment_distance(point, start, end):
    point = normalize_position(point)
    start = normalize_position(start)
    end = normalize_position(end)
    if not point or not start or not end:
        return None
    vx = end["x"] - start["x"]
    vy = end["y"] - start["y"]
    wx = point["x"] - start["x"]
    wy = point["y"] - start["y"]
    length_sq = vx * vx + vy * vy
    if length_sq <= 1e-9:
        return math.hypot(wx, wy)
    ratio = min(1.0, max(0.0, (wx * vx + wy * vy) / length_sq))
    nearest_x = start["x"] + ratio * vx
    nearest_y = start["y"] + ratio * vy
    return math.hypot(point["x"] - nearest_x, point["y"] - nearest_y)
