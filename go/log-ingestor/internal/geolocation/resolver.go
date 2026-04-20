// Package geolocation resolves client IP addresses to ISO 3166-1 alpha-2
// country codes using a local MaxMind GeoIP2 / GeoLite2 Country MMDB file.
// There is no outbound HTTP and no rate limiting — refresh the on-disk DB
// out-of-band (see deploy/ examples using geoipupdate).
//
// Merge checklist (replacing a legacy HTTP + throttle implementation):
//   - Delete any HTTP client code, public provider URLs, and geo-only throttles
//     (rate.Limit, 429 backoff, provider rotation).
//   - Set GEOIP_COUNTRY_DB_PATH in the ingestor process and mount the MMDB volume.
package geolocation

import (
	"fmt"
	"net"

	"github.com/oschwald/geoip2-golang"
)

// EnvCountryDBPath is the environment variable name operators should set for
// the GeoLite2-Country or GeoIP2-Country .mmdb path (mounted volume).
const EnvCountryDBPath = "GEOIP_COUNTRY_DB_PATH"

// Resolver performs offline country lookups.
type Resolver struct {
	r *geoip2.Reader
}

// Open loads a Country-format MaxMind DB from path (GeoLite2-Country.mmdb or GeoIP2-Country.mmdb).
func Open(path string) (*Resolver, error) {
	if path == "" {
		return nil, fmt.Errorf("geolocation: empty GEOIP_COUNTRY_DB_PATH")
	}
	r, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("geolocation: open database %q: %w", path, err)
	}
	return &Resolver{r: r}, nil
}

// Close releases the database handle.
func (res *Resolver) Close() error {
	if res == nil || res.r == nil {
		return nil
	}
	return res.r.Close()
}

// CountryISOCode returns the ISO 3166-1 alpha-2 code for ip (e.g. "US", "DE").
// It returns ("", false) for nil IP, non-global unicast (private, loopback,
// link-local, unspecified), addresses with no country row, or lookup errors.
func (res *Resolver) CountryISOCode(ip net.IP) (string, bool) {
	if res == nil || res.r == nil || ip == nil {
		return "", false
	}
	if !ip.IsGlobalUnicast() {
		return "", false
	}
	rec, err := res.r.Country(ip)
	if err != nil {
		return "", false
	}
	if rec.Country.IsoCode == "" {
		return "", false
	}
	return rec.Country.IsoCode, true
}
