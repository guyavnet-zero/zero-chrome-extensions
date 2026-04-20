package geolocation

import (
	"net"
	"path/filepath"
	"runtime"
	"testing"
)

func testDBPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(file), "testdata", "GeoIP2-Country-Test.mmdb")
}

func TestOpen_emptyPath(t *testing.T) {
	_, err := Open("")
	if err == nil {
		t.Fatal("expected error for empty path")
	}
}

func TestCountryISOCode_maxMindFixture(t *testing.T) {
	r, err := Open(testDBPath(t))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	// MaxMind test data: 214.78.120.0/22 → US (see MaxMind-DB source-data/GeoIP2-Country-Test.json).
	ip := net.ParseIP("214.78.120.1")
	code, ok := r.CountryISOCode(ip)
	if !ok || code != "US" {
		t.Fatalf("got (%q, %v), want (US, true)", code, ok)
	}

	// IPv6 fixture: 2001:218::/32 → JP
	ip6 := net.ParseIP("2001:218::1")
	code6, ok6 := r.CountryISOCode(ip6)
	if !ok6 || code6 != "JP" {
		t.Fatalf("IPv6 got (%q, %v), want (JP, true)", code6, ok6)
	}
}

func TestCountryISOCode_privateAndNil(t *testing.T) {
	r, err := Open(testDBPath(t))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	for _, ip := range []net.IP{
		nil,
		net.ParseIP("10.0.0.1"),
		net.ParseIP("127.0.0.1"),
		net.ParseIP("0.0.0.0"),
	} {
		code, ok := r.CountryISOCode(ip)
		if ok || code != "" {
			t.Fatalf("ip %v: got (%q, %v), want (\"\", false)", ip, code, ok)
		}
	}
}
