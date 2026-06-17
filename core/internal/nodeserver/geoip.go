package nodeserver

import (
	"fmt"
	"net"

	"github.com/oschwald/geoip2-golang"
)

// GeoData holds the geographical data for an IP.
type GeoData struct {
	CountryCode string  `json:"countryCode"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

var geoReader *geoip2.Reader

// InitGeoIP opens the MaxMind GeoLite2-City database. Optional: if it fails,
// LookupIP simply returns empty GeoData and the system runs without geolocation.
func InitGeoIP(dbPath string) error {
	var err error
	geoReader, err = geoip2.Open(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open GeoIP database at %s: %w", dbPath, err)
	}
	return nil
}

// CloseGeoIP cleanly closes the GeoIP database.
func CloseGeoIP() {
	if geoReader != nil {
		geoReader.Close()
	}
}

// LookupIP resolves an IP to coordinates + country/city via the in-memory
// MaxMind database. Returns empty GeoData for loopback/private/unknown IPs or
// when the database isn't loaded.
func LookupIP(ip string) GeoData {
	if ip == "" || ip == "127.0.0.1" || ip == "::1" || ip == "localhost" || geoReader == nil {
		return GeoData{}
	}
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return GeoData{}
	}
	record, err := geoReader.City(parsedIP)
	if err != nil {
		return GeoData{}
	}
	city := ""
	if enName, ok := record.City.Names["en"]; ok {
		city = enName
	}
	return GeoData{
		CountryCode: record.Country.IsoCode,
		City:        city,
		Lat:         record.Location.Latitude,
		Lon:         record.Location.Longitude,
	}
}
