#include <metal_stdlib>
using namespace metal;

struct Camera {
    float4 centerRadiusZoom;
    float4 rotation;
};

vertex float4 globeVertex(uint id [[vertex_id]]) {
    const float2 vertices[] = {{-1, -1}, {3, -1}, {-1, 3}};
    return float4(vertices[id], 0, 1);
}

fragment float4 globeFragment(float4 position [[position]],
                              constant Camera &camera [[buffer(0)]],
                              texture2d<float> earth [[texture(0)]],
                              texture2d<float> overlay [[texture(1)]],
                              texture2d<float> clouds [[texture(2)]],
                              texture2d<float> terrain [[texture(3)]]) {
    constexpr sampler globeSampler(coord::normalized, s_address::repeat, t_address::clamp_to_edge, filter::linear);
    const float3 background(0.0392, 0.0627, 0.0863);
    float2 xy = (position.xy - camera.centerRadiusZoom.xy) / camera.centerRadiusZoom.z;
    xy.y = -xy.y;
    const float d = length(xy);
    if (d > 1.0) {
        return float4(background + float3(0.06, 0.105, 0.14) * exp(-(d - 1.0) * 37.0), 1);
    }

    const float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
    const float4 r = camera.rotation;
    const float latitude = asin(clamp(xy.y * r.z + z * r.w, -1.0, 1.0));
    const float v = -xy.y * r.w + z * r.z;
    const float longitude = atan2(xy.x * r.x - v * r.y, xy.x * r.y + v * r.x);
    const float2 uv(longitude / 6.283185307 + 0.5, 0.5 - latitude / 3.141592654);
    float3 color = earth.sample(globeSampler, uv).rgb;
    const float3 relief = terrain.sample(globeSampler, uv).rgb;
    const float2 gradients = (relief.rg - 0.502) * 2.0;
    const float zoom = camera.centerRadiusZoom.w;
    color *= 1.0 + dot(gradients, float2(-0.30, 0.28)) * relief.b * smoothstep(1.25, 2.8, zoom);
    const float4 cloud = clouds.sample(globeSampler, uv);
    color = mix(color, float3(0.70, 0.77, 0.80), cloud.a * cloud.r * (0.26 - 0.22 * smoothstep(1, 2, zoom)));
    color *= 0.73 + 0.29 * clamp(dot(float3(xy, z), float3(-0.30, 0.37, 0.88)), 0.0, 1.0);
    color += float3(0.12, 0.20, 0.27) * pow(1.0 - z, 4.0);
    const float4 border = overlay.sample(globeSampler, uv);
    color = color * (1.0 - border.a) + border.rgb;
    return float4(color, 1);
}
