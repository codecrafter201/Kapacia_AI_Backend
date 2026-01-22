const mongoose = require('mongoose');
const User = mongoose.model('User');
const { imageUpload } = require('./UploadController');
const fs = require('fs');
const moment = require('moment');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ejs = require("ejs");
const path = require("path");
const crypto = require('crypto');
const { google } = require('googleapis');

let config = {};
config.app = require('../../../../config/app');
config.services = require('../../../../config/services');
const { JWT_EXPIRES_IN } = require('../../../../config/constants');
// const CREDENTIALS_PATH = require('../../../../client_secret_829788207768-3flhupuimkuj381v4es0qsapurd7b3e7.apps.googleusercontent.com.json');

const CREDENTIALS_PATH = 'kypi-436914-4fd271d14e54.json';
const json = require('../../../Traits/ApiResponser');
const email = require('../../../Traits/SendEmail');
/*
|--------------------------------------------------------------------------
| User Controller
|--------------------------------------------------------------------------
|
| This controller handles signup users and login for the application using
| facebook & google Oauth2. The controller uses a trait
| to conveniently provide its functionality to your applications.
|
*/

let o = {}
const sheets = google.sheets('v4');

// Replace with your credentials file path
const SPREADSHEET_ID = '1u7PCsWNHAAkLmSEvSHuReLVw3hwnF_cNLXCio_XszTA';

// const formatData = (response) => {
//     const rows = response.data.values;
//     if (!rows || rows.length === 0) return [];

//     const headers = rows[0];
//     return rows.slice(1).reduce((acc, row) => {
//         if (row.every(cell => !cell)) {
//             return acc; 
//         }
//         const rowData = {};
//         headers.forEach((header, index) => {
//             rowData[header] = row[index] || ''; 
//         });
//         acc.push(rowData);
//         return acc;
//     }, []);
// };


// const fetchSheetData = async () => {
//     try {
//         const auth = new google.auth.GoogleAuth({
//             keyFile: CREDENTIALS_PATH,
//             scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//         });

//         const authClient = await auth.getClient();

//         const eventsResponse = await sheets.spreadsheets.values.get({
//             auth: authClient,
//             spreadsheetId: SPREADSHEET_ID,
//             range: 'Master Events!A:Z',
//         });

//         const aggResponse = await sheets.spreadsheets.values.get({
//             auth: authClient,
//             spreadsheetId: SPREADSHEET_ID,
//             range: 'Master AGG!A:Z',
//         });

//         const formatData = (response) => {
//             const rows = response.data.values;
//             if (!rows || rows.length === 0) return [];

//             const headers = rows[0];
//             return rows.slice(1).reduce((acc, row) => {
//                 if (row.every(cell => !cell)) {
//                     return acc;
//                 }
//                 const rowData = {};
//                 headers.forEach((header, index) => {
//                     rowData[header] = row[index] || '';
//                 });
//                 acc.push(rowData);
//                 return acc;
//             }, []);
//         };

//         const masterEvents = formatData(eventsResponse);
//         const masterAgg = formatData(aggResponse);

//         return { masterEvents, masterAgg };
//     } catch (error) {
//         console.error('Error fetching sheet data:', error);
//         throw error;
//     }
// };

const fetchSheetData = async () => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const authClient = await auth.getClient();

        const eventsResponse = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: SPREADSHEET_ID,
            range: 'Master Events!A:CG',
        });

        const aggResponse = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: SPREADSHEET_ID,
            range: 'Master AGG!A:CG',
        });

        const formatSheetData = (data) => {
            const headers = data[0];
            const rows = data.slice(1);

            return rows
                .filter(row => row.length > 0)
                .map(row => {
                    const obj = {};
                    headers.forEach((header, index) => {
                        obj[header] = row[index] ? row[index] : null;
                    });
                    return obj;
                });
        };

        const masterEvents = formatSheetData(eventsResponse.data.values);
        const masterAgg = formatSheetData(aggResponse.data.values);

        return { masterEvents, masterAgg };
    } catch (error) {
        console.error('Error fetching sheet data:', error);
        throw error;
    }
};

// o.stats = async (req, res, next) => {
//     try {
//         const { masterEvents, masterAgg } = await fetchSheetData();
//         return json.showAll(res, { masterEvents, masterAgg }, 200);
//     } catch (error) {
//         console.error('Cannot access the file:', error);
//         res.status(500).json({ error: error });
//     }

// }


o.stats = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const { masterEvents, masterAgg } = await fetchSheetData();

        if (!Array.isArray(masterEvents)) {
            return res.status(500).json({ error: 'Master Events is not an array' });
        }
        if (!Array.isArray(masterAgg)) {
            return res.status(500).json({ error: 'Master Agg is not an array' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        console.log("Data start", start)
        console.log("Data end", end)

        const filteredEventsMaster = masterEvents.filter(event => {
            const eventTime = new Date(event["Event Time"]);
            return eventTime >= start && eventTime <= end;
        });
        const filteredEventsAgg = masterAgg.filter(event => {
            const eventTime = new Date(event["Date"]);
            return eventTime >= start && eventTime <= end;
        });

        const eventName = "af_first_deposit";
        const eventNameComplt = "af_complete_registration";
        const FTDUinique = filteredEventsMaster.filter(event => event["Event Name"] === eventName).length;
        const SignedUnique = filteredEventsMaster.filter(event => event["Event Name"] === eventNameComplt).length;

        const AF_FIRST_DEPOSIT = 50;
        const budget = FTDUinique * AF_FIRST_DEPOSIT;

        const installsSum = filteredEventsAgg
            .filter(row => row["Installs"])
            .reduce((sum, row) => sum + parseInt(row["Installs"] || 0, 10), 0);

        return json.showAll(res, { budget, FTDUinique, SignedUnique, installsSum }, 200);
    } catch (error) {
        console.error('Error calculating budget:', error);
        res.status(500).json({ error: 'Error calculating budget' });
    }
};


o.chartData = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const { masterEvents } = await fetchSheetData();

        if (!Array.isArray(masterEvents)) {
            return res.status(500).json({ error: 'Master Events is not an array' });
        }

        const start = moment(startDate);
        const end = moment(endDate);

        const chartData = {};

        masterEvents.forEach(event => {
            const eventTime = moment(event["Event Time"]);
            if (eventTime.isBetween(start, end, null, '[]')) {
                const dateString = eventTime.format('D MMM YYYY');

                if (!chartData[dateString]) {
                    chartData[dateString] = {
                        name: dateString,
                        al_complete_registration: 0,
                        al_first_depot: 0,
                    };
                }

                if (event["Event Name"] === "af_complete_registration") {
                    chartData[dateString].al_complete_registration += 1;
                } else if (event["Event Name"] === "af_first_deposit") {
                    chartData[dateString].al_first_depot += 1;
                }
            }
        });

        const chartDataArray = Object.values(chartData);
        return json.showAll(res, chartDataArray, 200);
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Error fetching chart data' });
    }
};


o.tableData = async (req, res, next) => {
    try {
        const { startDate, endDate, page = 1, limit = 7 } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const { masterEvents } = await fetchSheetData();

        if (!Array.isArray(masterEvents)) {
            return res.status(500).json({ error: 'Master Events is not an array' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const filteredEvents = masterEvents.filter(event => {
            const eventTime = new Date(event["Event Time"]);
            return eventTime >= start && eventTime <= end;
        });

        const campaignData = {};

        filteredEvents.forEach(event => {
            const weekNumber = moment(event["Event Time"]).isoWeek();
            const countryCode = event["Country Code"];
            const appId = event["App ID"];
            const campaign = event["Campaign"];

            const key = `${campaign}-${appId}-${weekNumber}-${countryCode}`;

            if (!campaignData[key]) {
                campaignData[key] = {
                    campaign: campaign,
                    appId: appId,
                    week: weekNumber,
                    countryCode: countryCode,
                    FTDUnique: 0,
                };
            }

            if (event["Event Name"] === "af_first_deposit") {
                campaignData[key].FTDUnique += 1;
            }
        });

        const tableDataArray = Object.values(campaignData);

        const totalItems = tableDataArray.length;
        const totalPages = Math.ceil(totalItems / limit);
        const paginatedData = tableDataArray.slice((page - 1) * limit, page * limit);

        return json.showAll(res, { data: paginatedData, totalPages, totalItems }, 200);
    } catch (error) {
        console.error('Error fetching table data:', error);
        res.status(500).json({ error: 'Error fetching table data' });
    }
};

o.pieChartData = async (req, res, next) => {
    try {
        const { startDate, endDate, page = 1, limit = 7 } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const { masterEvents } = await fetchSheetData();

        if (!Array.isArray(masterEvents)) {
            return res.status(500).json({ error: 'Master Events is not an array' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const filteredEvents = masterEvents.filter(event => {
            const eventTime = new Date(event["Event Time"]);
            return eventTime >= start && eventTime <= end;
        });
        const eventName = "af_first_deposit";
        const FTDUinique = filteredEvents.filter(event => event["Event Name"] === eventName).length;
        const campaignData = {};

        filteredEvents.forEach(event => {
            const weekNumber = moment(event["Event Time"]).isoWeek();

            const key = `${weekNumber}`;

            if (!campaignData[key]) {
                campaignData[key] = {
                    name: `Week ${weekNumber}`,
                    value: 0,
                };
            }

            if (event["Event Name"] === "af_first_deposit") {
                campaignData[key].value += 1;
            }
        });

        const dashboardPie = Object.values(campaignData).map(item => ({
            name: item.name,
            value: FTDUinique > 0 ? ((item.value / FTDUinique) * 100).toFixed(1) : 0 // Calculate percentage
        }));
        return json.showAll(res, dashboardPie, 200);
    } catch (error) {
        console.error('Error fetching table data:', error);
        res.status(500).json({ error: 'Error fetching table data' });
    }
};

module.exports = o;